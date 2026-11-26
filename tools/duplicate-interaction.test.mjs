import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'
import { shape } from './selection-fixture.mjs'

async function fixture(commands = [shape('a', 100, 200, { props: { w: 100, h: 80, fill: 'solid' } })], options = {}) {
  const { beforeCommit, ...interactionOptions } = options
  const initial = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
  const base = memoryTransport(initial), commits = []
  const session = await createEditorSession({ actor: 'duplicate-input', transport: { ...base, commit: async request => { if (beforeCommit) await beforeCommit(request); commits.push(request); return base.commit(request) } } })
  const interaction = createCanvasInteraction({ session, edgeScrolling: false, ...interactionOptions }); let time = 0
  const input = value => interaction.dispatch({ time: ++time, ...value })
  const pointer = (type, x, y, modifiers = {}) => input({ type: `pointer_${type}`, point: { x, y }, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, ...modifiers })
  const key = (key, modifiers = {}, type = 'down') => input({ type: `key_${type}`, key, ...modifiers })
  const selected = () => [...interaction.state.get().selectedIds]
  const records = () => session.store.getStoreSnapshot().store
  const select = async (x = 140, y = 240) => { pointer('down', x, y); await pointer('up', x, y) }
  const duplicate = () => key('d', { metaKey: true })
  return { session, interaction, input, pointer, key, records, selected, select, duplicate, commits, initial,
    remote: async commands => { const current = await base.read(); await base.commit({ actor: 'remote', expectedRevision: current.revision, commands }); await session.refresh() },
    close() { interaction.dispose(); session.dispose() } }
}
const pose = (f, id) => [f.records()[id].x, f.records()[id].y]
const shapes = f => Object.values(f.records()).filter(r => r.typeName === 'shape')

test('TL-B10 Mod+D连续三次使用选择宽+10，选副本，移动副本后仍沿用偏移，分别撤销', async () => {
  const f = await fixture()
  try {
    await f.select()
    const ids = []
    for (const x of [210, 320, 430]) { await f.duplicate(); ids.push(f.selected()[0]); assert.deepEqual(pose(f, ids.at(-1)), [x, 200]) }
    assert.deepEqual(pose(f, 'shape:a'), [100, 200]); assert.equal(f.commits.length, 3)
    await f.key('z', { metaKey: true }); assert.equal(shapes(f).length, 3); assert.deepEqual(f.selected(), [ids[1]])
    await f.key('z', { metaKey: true, shiftKey: true }); assert.deepEqual(f.selected(), [ids[2]])
    f.pointer('down', 470, 240); f.pointer('move', 550, 290); await f.pointer('up', 550, 290)
    assert.deepEqual(pose(f, ids[2]), [510, 250])
    await f.duplicate(); assert.deepEqual(pose(f, f.selected()[0]), [620, 250])
  } finally { f.close() }
})

test('TL-B10 多选按画布范围宽+10，缩放不改画布偏移；公开动作和快捷键同路', async () => {
  for (const z of [1, 2]) {
    const f = await fixture([shape('a', 100, 200, { props: { w: 100, h: 80, fill: 'solid' } }), shape('b', 500, 400, { props: { w: 100, h: 80, fill: 'solid' } })], { camera: { x: 0, y: 0, z } })
    try {
      await f.select(140 * z, 240 * z)
      f.pointer('down', 540 * z, 440 * z, { shiftKey: true }); await f.pointer('up', 540 * z, 440 * z, { shiftKey: true })
      assert.equal(f.interaction.getActions().find(a => a.id === 'duplicate')?.available, true)
      assert.equal((await f.interaction.runAction('duplicate')).status, 'applied')
      assert.deepEqual(f.selected().map(id => pose(f, id)).sort((a, b) => a[0] - b[0]), [[610, 200], [1010, 400]])
      assert.equal(f.commits.length, 1)
    } finally { f.close() }
  }
})

test('TL-B09 Alt逐帧切换保留起点、选当前对象、新ID重建；只在松手提交一次并整次撤销重做', async () => {
  const f = await fixture()
  try {
    await f.select(); f.pointer('down', 140, 240); f.pointer('move', 190, 270)
    assert.deepEqual(pose(f, 'shape:a'), [150, 230])
    f.key('Alt', { altKey: true }); const first = f.selected()[0]
    assert.notEqual(first, 'shape:a'); assert.deepEqual(pose(f, 'shape:a'), [100, 200]); assert.deepEqual(pose(f, first), [150, 230])
    f.pointer('move', 230, 300, { altKey: true }); assert.deepEqual(pose(f, first), [190, 260])
    f.key('Alt', {}, 'up'); assert.equal(f.records()[first], undefined); assert.deepEqual(f.selected(), ['shape:a']); assert.deepEqual(pose(f, 'shape:a'), [190, 260])
    f.key('Alt', { altKey: true }); const second = f.selected()[0]; assert.notEqual(second, first)
    assert.deepEqual(pose(f, 'shape:a'), [100, 200]); assert.deepEqual(pose(f, second), [190, 260]); assert.equal(f.commits.length, 0)
    await f.pointer('up', 230, 300, { altKey: true }); assert.equal(f.commits.length, 1)
    await f.key('z', { metaKey: true }); assert.deepEqual(f.records(), f.initial.store); assert.deepEqual(f.selected(), ['shape:a'])
    await f.key('z', { metaKey: true, shiftKey: true }); assert.deepEqual(f.selected(), [second]); assert.deepEqual(pose(f, second), [190, 260])
  } finally { f.close() }
})

test('TL-B10 Alt复制建立连续偏移；移动副本沿用该偏移，选择别的对象后回到默认间距', async () => {
  const f = await fixture([shape('a', 100, 200, { props: { w: 100, h: 80, fill: 'solid' } }), shape('b', 800, 500)])
  try {
    await f.select(); f.pointer('down', 140, 240, { altKey: true }); f.pointer('move', 210, 280, { altKey: true }); await f.pointer('up', 210, 280, { altKey: true })
    await f.duplicate(); assert.deepEqual(pose(f, f.selected()[0]), [240, 280])
    f.pointer('down', 280, 320); f.pointer('move', 360, 370); await f.pointer('up', 360, 370)
    await f.duplicate(); assert.deepEqual(pose(f, f.selected()[0]), [390, 370])
    await f.select(830, 530); await f.duplicate(); assert.deepEqual(pose(f, f.selected()[0]), [890, 500])
  } finally { f.close() }
})

test('TL-B09 起手Alt再松开只移动原件；Esc/取消/失焦撤掉整次复制，无提交无残留', async () => {
  for (const cancel of ['escape', 'pointer', 'blur', 'alt-up']) {
    const f = await fixture()
    try {
      await f.select(); f.pointer('down', 140, 240, { altKey: true }); f.pointer('move', 210, 280, { altKey: true })
      assert.equal(shapes(f).length, 2)
      if (cancel === 'alt-up') { f.key('Alt', {}, 'up'); await f.pointer('up', 210, 280); assert.deepEqual(pose(f, 'shape:a'), [170, 240]); assert.deepEqual(f.selected(), ['shape:a']); assert.equal(shapes(f).length, 1); assert.equal(f.commits.length, 1); await f.key('z', { metaKey: true }) }
      else if (cancel === 'escape') f.key('Escape')
      else if (cancel === 'pointer') f.pointer('cancel', 210, 280)
      else f.interaction.setInputContext({ owner: 'form' })
      assert.deepEqual(f.records(), f.initial.store); assert.deepEqual(f.selected(), ['shape:a']); assert.equal(f.commits.length, cancel === 'alt-up' ? 1 : 0)
    } finally { f.close() }
  }
})

test('TL-B09 Alt未过拖动门槛不复制，Shift与旋转父框的画布位移仍正确', async () => {
  const f = await fixture([shape('frame', 100, 100, { shapeType: 'frame', rotation: Math.PI / 2, props: { w: 300, h: 300 } }), shape('a', 40, 50, { parentId: 'shape:frame', props: { w: 100, h: 80, fill: 'solid' } })])
  try {
    f.interaction.select('all'); f.interaction.select('child')
    assert.deepEqual(f.selected(), ['shape:a'])
    f.pointer('down', 10, 180, { altKey: true }); f.pointer('move', 13, 180, { altKey: true }); assert.equal(shapes(f).length, 2)
    f.pointer('move', 50, 200, { altKey: true, shiftKey: true }); await f.pointer('up', 50, 200, { altKey: true, shiftKey: true })
    const copy = f.records()[f.selected()[0]]; assert.equal(copy.parentId, 'shape:frame'); assert.ok(Math.abs(copy.x - 40) < 1e-9); assert.ok(Math.abs(copy.y - 10) < 1e-9)
  } finally { f.close() }
})

test('TL-B10 表单、输入法、关闭快捷键、活动拖动、提交中和锁定目标拒绝Mod+D', async () => {
  for (const mode of ['form', 'ime', 'disabled', 'dragging', 'locked']) {
    const f = await fixture()
    try {
      await f.select()
      if (mode === 'form') f.interaction.setInputContext({ owner: 'form' })
      if (mode === 'ime') f.interaction.setInputContext({ owner: 'canvas', isComposing: true })
      if (mode === 'disabled') f.interaction.setShortcutsEnabled(false)
      if (mode === 'dragging') { f.pointer('down', 140, 240); f.pointer('move', 160, 240) }
      if (mode === 'locked') await f.interaction.runAction('toggle-lock')
      const before = structuredClone(f.records()), commits = f.commits.length
      await f.duplicate(); assert.deepEqual(f.records(), before, mode); assert.equal(f.commits.length, commits, mode)
    } finally { f.close() }
  }
})

test('TL-B09 组与画框只复制一次全部后代，原件不动，整次撤销重做包括内部绑定', async () => {
  for (const type of ['group', 'frame']) {
    const f = await fixture([
      { type: 'create_shape', id: 'shape:container', shapeType: type, x: 100, y: 200, props: type === 'frame' ? { w: 300, h: 200 } : {} },
      shape('a', 0, 0, { parentId: 'shape:container' }), shape('b', 180, 0, { parentId: 'shape:container' }),
      { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', parentId: 'shape:container', y: 30, props: { start: { x: 80, y: 0 }, end: { x: 180, y: 0 } } },
      { type: 'put', record: { id: 'binding:inside', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:b', props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: true, isPrecise: true, snap: 'none' }, meta: {} } },
    ])
    try {
      await f.select(type === 'frame' ? 390 : 130, type === 'frame' ? 350 : 230)
      assert.deepEqual(f.selected(), ['shape:container'])
      const start = type === 'frame' ? [390, 350] : [130, 230]
      f.pointer('down', ...start, { altKey: true }); f.pointer('move', start[0] + 70, start[1] + 40, { altKey: true })
      await f.pointer('up', start[0] + 70, start[1] + 40, { altKey: true })
      const copy = f.selected()[0], records = f.records(), children = Object.values(records).filter(r => r.parentId === copy)
      assert.notEqual(copy, 'shape:container'); assert.equal(children.length, 3); assert.deepEqual(pose(f, 'shape:container'), [100, 200]); assert.deepEqual(pose(f, copy), [170, 240])
      const bound = Object.values(records).find(r => r.typeName === 'binding' && children.some(s => s.id === r.fromId))
      assert.ok(children.some(s => s.id === bound.toId)); assert.equal(f.commits.length, 1)
      await f.key('z', { metaKey: true }); assert.deepEqual(f.records(), f.initial.store)
      await f.key('z', { metaKey: true, shiftKey: true }); assert.deepEqual(f.records(), records)
    } finally { f.close() }
  }
})

test('TL-B09 起点或父框被并发更改时取消，不用旧坐标复制；无关记录刷新允许继续', async () => {
  for (const changed of ['a', 'frame', 'other']) {
    const f = await fixture([{ type: 'create_shape', id: 'shape:frame', shapeType: 'frame', props: { w: 600, h: 600 } }, shape('a', 100, 200, { parentId: 'shape:frame', props: { w: 100, h: 80, fill: 'solid' } }), shape('other', 800, 500)])
    try {
      await f.select(); f.pointer('down', 140, 240)
      await f.remote([{ type: 'update', id: `shape:${changed}`, changes: { x: 101 } }])
      if (changed === 'other') {
        f.pointer('move', 210, 280, { altKey: true }); await f.pointer('up', 210, 280, { altKey: true })
        assert.deepEqual(pose(f, f.selected()[0]), [170, 240]); assert.equal(f.commits.length, 1)
      } else {
        assert.throws(() => f.pointer('move', 210, 280, { altKey: true }), error => error.code === 'conflict')
        assert.equal(shapes(f).length, 3); assert.equal(f.commits.length, 0); assert.equal(f.records()[`shape:${changed}`].x, 101)
      }
    } finally { f.close() }
  }
})

test('TL-B10 提交中拒绝下一次复制，失败恢复原选择', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = await fixture(undefined, { beforeCommit: () => gate })
  try {
    await f.select(); const pending = f.duplicate(), before = structuredClone(f.records())
    await f.duplicate(); assert.deepEqual(f.records(), before); assert.equal(f.commits.length, 0)
    release(); await pending; assert.equal(f.commits.length, 1)
  } finally { release(); f.close() }
  const rejected = await fixture(undefined, { beforeCommit: () => { throw new Error('synthetic rejection') } })
  try {
    await rejected.select(); await assert.rejects(rejected.duplicate(), /synthetic rejection/)
    assert.deepEqual(rejected.records(), rejected.initial.store); assert.deepEqual(rejected.selected(), ['shape:a'])
  } finally { rejected.close() }
})

test('TL-B10 新交互会话不继承复制偏移、选择或相机，快照只含文档记录', async () => {
  const f = await fixture(); let snapshot
  try {
    await f.select(); f.pointer('down', 140, 240, { altKey: true }); f.pointer('move', 210, 280, { altKey: true }); await f.pointer('up', 210, 280, { altKey: true })
    snapshot = structuredClone(f.records())
    assert.ok(Object.values(snapshot).every(r => ['document', 'page', 'shape', 'binding', 'asset'].includes(r.typeName)))
  } finally { f.close() }
  const reopened = await fixture(Object.values(snapshot).map(record => ({ type: 'put', record })))
  try {
    assert.deepEqual(reopened.selected(), [])
    await reopened.select(230, 290); await reopened.duplicate()
    assert.deepEqual(pose(reopened, reopened.selected()[0]), [280, 240])
  } finally { reopened.close() }
})

test('TL-B10 已有Alt复制偏移在下一次Alt预览取消、松键移动或提交失败后保留', async () => {
  for (const finish of ['escape', 'alt-up', 'cancel-after-alt-up', 'rejection']) {
    let attempts = 0
    const f = await fixture(undefined, { beforeCommit: () => { if (++attempts === 2 && finish === 'rejection') throw new Error('synthetic second rejection') } })
    try {
      await f.select(); f.pointer('down', 140, 240, { altKey: true }); f.pointer('move', 210, 280, { altKey: true }); await f.pointer('up', 210, 280, { altKey: true })
      const copy = f.selected()[0]
      f.pointer('down', 230, 300); f.pointer('move', 250, 310, { altKey: true })
      if (finish === 'escape') f.key('Escape')
      if (finish === 'alt-up' || finish === 'cancel-after-alt-up') {
        f.key('Alt', {}, 'up')
        if (finish === 'alt-up') await f.pointer('up', 250, 310)
        else f.key('Escape')
      }
      if (finish === 'rejection') await assert.rejects(f.pointer('up', 250, 310, { altKey: true }), /synthetic second rejection/)
      assert.deepEqual(f.selected(), [copy])
      await f.duplicate(); assert.deepEqual(pose(f, f.selected()[0]), finish === 'alt-up' ? [260, 290] : [240, 280], finish)
    } finally { f.close() }
  }
})
