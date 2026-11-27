import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture, rectangle, moving } from './snapping-test-fixture.mjs'

// Independent old-runtime readback: raw x309 is closer to grid310 than to
// object303, yet both enabled choose303. The grid-only control must choose310.
test('对象优先级反例：更近的网格不能抢走对象吸附；无对象策略才落网格', async () => {
  for (const enabled of [false, true]) {
    const f = await creationFixture({ snapping: { enabled, grid: true }, commands: [rectangle('shape:fixed', 203, 200, 100, 80), rectangle('shape:moving', 430, 320, 60, 50)] })
    try {
      f.pointer('down', 460, 345)
      f.pointer('move', 339, 345)
      assert.equal(moving(f).x, enabled ? 303 : 310)
      assert.equal(f.commits.length, 0)
      await f.key('Escape')
      assert.equal(moving(f).x, 430)
    } finally { f.close() }
  }
})

test('精确对象边303不被网格拉走，另一轴仍独立落网格且提示落在最终外框', async () => {
  const f = await creationFixture({ snapping: { enabled: true, grid: true }, commands: [rectangle('shape:fixed', 200, 200, 103, 80), rectangle('shape:moving', 430, 320, 60, 50)] })
  try {
    f.pointer('down', 460, 345); f.pointer('move', 333, 348)
    assert.deepEqual([moving(f).x, moving(f).y], [303, 320])
    const guide = f.interaction.state.get().overlays.find(o => o.kind === 'snap-guides')
    assert.ok(guide.lines.some(line => line.points.some(p => p.x === 303 && p.y === 370)))
  } finally { f.close() }
})

// Old native readback: grid rounds right387 to390 before object eligibility.
// Object383 is 7 CSS px away at z1, but 14px away at z2 and must be rejected.
for (const zoom of [.5, 1, 2]) test(`缩放先落格再判断对象半径，Command绕过两者，视角${zoom}`, async () => {
  const f = await creationFixture({ snapping: { enabled: true, grid: true }, camera: { x: 0, y: 0, z: zoom }, commands: [rectangle('shape:moving', 100, 180, 150, 100), rectangle('shape:fixed', 383, 180, 90, 100)] })
  try {
    await f.click(175 * zoom, 230 * zoom)
    f.pointer('down', 250 * zoom, 230 * zoom); f.pointer('move', 387 * zoom, 230 * zoom)
    assert.equal(moving(f).props.w, zoom === 2 ? 290 : 283)
    f.key('Meta', { metaKey: true }); assert.equal(moving(f).props.w, 287)
    f.key('Meta', {}, 'key_up'); assert.equal(moving(f).props.w, zoom === 2 ? 290 : 283)
    f.key('Escape'); assert.equal(moving(f).props.w, 150)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('网格保留Shift轴锁、Alt中心及等比约束；微移失焦和远端目标冲突仍取消', async () => {
  const f = await creationFixture({ snapping: { grid: true }, commands: [rectangle('shape:moving', 103, 107, 60, 50)] })
  try {
    f.pointer('down', 130, 130); f.pointer('move', 177, 133, { shiftKey: true })
    assert.deepEqual([moving(f).x, moving(f).y], [150, 107])
    f.key('Escape'); await f.click(130, 130)
    f.key('ArrowRight'); assert.equal(moving(f).x, 113)
    f.interaction.setInputContext({ owner: 'form' }); assert.equal(moving(f).x, 103)
    f.interaction.setInputContext({ owner: 'canvas' }); f.key('ArrowRight')
    await f.remote([{ type: 'update', id: 'shape:moving', changes: { x: 803 } }])
    assert.throws(() => f.key('ArrowRight', {}, 'key_up'), /微移|修改/)
    assert.equal(moving(f).x, 803); assert.equal(f.commits.length, 0)
  } finally { f.close() }
  const r = await creationFixture({ snapping: { grid: true }, commands: [rectangle('shape:moving', 100, 180, 150, 100)] })
  try {
    await r.click(175, 230); r.pointer('down', 250, 230); r.pointer('move', 387, 230, { altKey: true })
    assert.equal(moving(r).x + moving(r).props.w / 2, 175)
    assert.equal(moving(r).x + moving(r).props.w, 390)
    r.key('Escape'); await r.click(175, 230)
    r.pointer('down', 250, 280); r.pointer('move', 387, 350, { shiftKey: true })
    assert.ok(Math.abs(moving(r).props.w / moving(r).props.h - 1.5) < 1e-7)
    assert.equal(moving(r).props.w, 290)
    assert.ok(Math.abs(moving(r).props.h - 193.33333333333334) < 1e-7)
  } finally { r.close() }
})

test('网格是不可变会话状态：公开读写、两窗口独立、无保存/撤销项，非法更新原子拒绝', async () => {
  const input = { grid: true }, f = await creationFixture({ snapping: input }), other = await creationFixture()
  try {
    const before = JSON.stringify(f.current())
    input.grid = false
    assert.equal(f.interaction.getSnappingPreferences().grid, true)
    assert.equal(other.interaction.getSnappingPreferences().grid, false)
    assert.ok(Object.isFrozen(f.interaction.state.get().snappingPreferences))
    const grid = f.interaction.state.get().overlays.find(o => o.kind === 'grid')
    assert.equal(grid.spacing, 10)
    assert.ok(Object.isFrozen(grid))
    assert.throws(() => f.interaction.setSnappingPreferences({ grid: false, enabled: 'yes' }), /吸附/)
    assert.equal(f.interaction.getSnappingPreferences().grid, true)
    f.interaction.setCamera({ x: 13, y: -7, z: .5 })
    f.interaction.setSnappingPreferences({ grid: false })
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'grid'), false)
    assert.equal(JSON.stringify(f.current()), before)
    assert.equal(f.commits.length, 0)
  } finally { f.close(); other.close() }
})

for (const zoom of [.5, 1, 2]) test(`网格移动与10/50微移以画布单位计算，视角${zoom}`, async () => {
  const f = await creationFixture({ snapping: { grid: true }, camera: { x: 0, y: 0, z: zoom }, commands: [rectangle('shape:moving', 103, 107, 60, 50)] })
  try {
    f.pointer('down', 130 * zoom, 130 * zoom)
    f.pointer('move', 177 * zoom, 163 * zoom)
    assert.deepEqual([moving(f).x, moving(f).y], [150, 140])
    await f.pointer('up', 177 * zoom, 163 * zoom)
    f.key('ArrowRight'); assert.equal(moving(f).x, 160)
    await f.key('ArrowRight', {}, 'key_up')
    f.key('ArrowDown', { shiftKey: true }); assert.equal(moving(f).y, 190)
    await f.key('ArrowDown', {}, 'key_up')
    await f.session.undo(); assert.equal(moving(f).y, 140)
  } finally { f.close() }
})

test('移动中Command按下/释放即时绕过网格、反转对象，切偏好重算且取消不保存', async () => {
  for (const enabled of [false, true]) {
    const f = await creationFixture({ snapping: { enabled, grid: true }, commands: [rectangle('shape:fixed', 203, 200, 100, 80), rectangle('shape:moving', 430, 320, 60, 50)] })
    try {
      f.pointer('down', 460, 345); f.pointer('move', 339, 345)
      assert.equal(moving(f).x, enabled ? 303 : 310)
      f.key('Meta', { metaKey: true }); assert.equal(moving(f).x, enabled ? 309 : 303)
      f.key('Meta', {}, 'key_up'); assert.equal(moving(f).x, enabled ? 303 : 310)
      f.interaction.setSnappingPreferences({ grid: false, enabled: false }); assert.equal(moving(f).x, 309)
      f.interaction.setSnappingPreferences({ grid: true }); assert.equal(moving(f).x, 310)
      f.key('Escape'); assert.equal(moving(f).x, 430)
      assert.equal(f.commits.length, 0)
      assert.equal(f.interaction.state.get().overlays.filter(o => o.kind === 'grid').length, 1)
    } finally { f.close() }
  }
})

test('网格微移是10/50画布单位，保留非格点偏移；按住只在松键保存一次', async () => {
  const f = await creationFixture({ snapping: { grid: true }, commands: [rectangle('shape:moving', 103, 107, 60, 50)] })
  try {
    await f.click(130, 130)
    f.key('ArrowRight')
    assert.equal(moving(f).x, 113)
    f.key('ArrowRight', { repeat: true })
    assert.equal(moving(f).x, 123)
    assert.equal(f.commits.length, 0)
    await f.key('ArrowRight', {}, 'key_up')
    assert.equal(f.commits.length, 1)
    f.key('ArrowDown', { shiftKey: true })
    assert.equal(moving(f).y, 157)
    await f.key('ArrowDown', {}, 'key_up')
    await f.session.undo()
    assert.equal(moving(f).y, 107)
    f.interaction.setSnappingPreferences({ grid: false })
    await f.interaction.runAction('nudge-right')
    assert.equal(moving(f).x, 124)
    f.interaction.setSnappingPreferences({ grid: true })
    await f.interaction.runAction('nudge-left', { largeStep: true })
    assert.equal(moving(f).x, 74)
  } finally { f.close() }
})

test('网格缩放修正活动边到格点，固定对边不动，松手整次保存撤销', async () => {
  const f = await creationFixture({ snapping: { grid: true }, commands: [rectangle('shape:moving', 100, 180, 150, 100)] })
  try {
    await f.click(175, 230)
    f.pointer('down', 250, 230)
    f.pointer('move', 387, 230)
    assert.equal(moving(f).props.w, 290)
    assert.equal(moving(f).x, 100)
    assert.equal(f.commits.length, 0)
    await f.pointer('up', 387, 230)
    assert.equal(f.commits.length, 1)
    await f.session.undo()
    assert.equal(moving(f).props.w, 150)
  } finally { f.close() }
})
