import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'
import { createImageGallery } from './renderer-preview/image-fixtures.js'
import { selectionFixture, shape } from './selection-fixture.mjs'

async function fixture(commands, snapshot = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot) {
  const transport = memoryTransport(snapshot), commits = [], original = transport.commit
  transport.commit = request => { commits.push(request); return original(request) }
  const session = await createEditorSession({ actor: 'action-history', transport })
  const interaction = createCanvasInteraction({ session })
  let time = 0
  const key = (key, extra = {}, phase = 'down') => interaction.dispatch({ type: `key_${phase}`, key, ...extra, time: ++time })
  return { session, interaction, commits, key, snapshot, close() { interaction.dispose(); session.dispose() } }
}
const base = () => [shape('a', 100, 100), shape('b', 330, 190, { props: { w: 120, h: 80 } }), shape('c', 620, 360, { props: { w: 60, h: 40 } })]

test('层序动作使用重叠模式，不重叠不保存，置顶置底仍跨所有对象', async () => {
  const f = await fixture([shape('a', 100, 100), shape('b', 900, 100), shape('c', 140, 100)])
  const order = () => f.session.store.allRecords().filter(r => r.typeName === 'shape').sort((a, b) => a.index < b.index ? -1 : 1).map(r => r.id.slice(6)).join('')
  try {
    f.interaction.select('first'); assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    await f.key(']', { code: 'BracketRight', altKey: true }); assert.equal(order(), 'bca')
    await f.session.undo(); assert.equal(order(), 'abc')
    await f.key('[', { code: 'BracketLeft', altKey: true }); assert.equal(order(), 'abc'); assert.equal(f.commits.length, 1)
    await f.interaction.runAction('reorder-front'); assert.equal(order(), 'bca')
    await f.interaction.runAction('reorder-back'); assert.equal(order(), 'abc')
    await f.session.undo(); assert.equal(order(), 'bca')
  } finally { f.close() }
})

for (const id of [
  'align-left', 'align-center-horizontal', 'align-right', 'align-top', 'align-center-vertical', 'align-bottom',
  'stretch-x', 'stretch-y', 'distribute-x', 'distribute-y', 'stack-x', 'stack-y', 'pack', 'flip-x', 'flip-y',
  'rotate-clockwise', 'rotate-counterclockwise', 'rotate-clockwise-fine', 'rotate-counterclockwise-fine', 'enlarge', 'shrink',
  'nudge-left', 'nudge-right', 'nudge-up', 'nudge-down', 'group', 'toggle-lock', 'delete',
]) test(`动作 ${id} 一次保存、一次撤销完整还原，重做相同`, async () => {
  const f = await fixture(base())
  try {
    f.interaction.select('all')
    assert.equal((await f.interaction.runAction(id)).status, 'applied')
    const after = f.session.store.getStoreSnapshot()
    assert.equal(f.commits.length, 1)
    await f.session.undo(); assert.deepEqual(f.session.store.getStoreSnapshot(), f.snapshot)
    await f.session.redo(); assert.deepEqual(f.session.store.getStoreSnapshot(), after)
  } finally { f.close() }
})

test('微移真实重复是一条撤销，分开的两次是两条；多方向都松开才提交，缩放不改变步长', async () => {
  const f = await fixture([shape('a', 100, 100)])
  try {
    f.interaction.select('all'); f.interaction.setCamera({ x: 0, y: 0, z: 2 })
    f.key('ArrowRight'); for (let i = 0; i < 3; i++) f.key('ArrowRight', { repeat: true })
    f.key('ArrowDown', { shiftKey: true }); await f.key('ArrowRight', { metaKey: true }, 'up')
    assert.equal(f.commits.length, 0)
    await f.key('ArrowDown', {}, 'up'); assert.equal(f.commits.length, 1)
    assert.equal(f.session.store.get('shape:a').x, 104); assert.equal(f.session.store.get('shape:a').y, 110)
    await f.session.undo(); assert.equal(f.session.store.get('shape:a').x, 100)
    await f.session.redo(); assert.equal(f.session.store.get('shape:a').x, 104)
    for (let i = 0; i < 2; i++) { f.key('ArrowRight'); await f.key('ArrowRight', {}, 'up') }
    await f.session.undo(); assert.equal(f.session.store.get('shape:a').x, 105)
    assert.equal(f.commits.length, 3)
  } finally { f.close() }
})

test('组合快捷键可切换解组，混选解组先非组再子项；画框留白和移除保留内容选择', async () => {
  const f = await fixture([...base(), { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }])
  try {
    f.interaction.select('all'); await f.key('g', { metaKey: true, shiftKey: true })
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:c', 'shape:a', 'shape:b'])
    await f.key('g', { metaKey: true }); assert.equal(f.interaction.state.get().selectedIds.length, 1)
    await f.key('g', { metaKey: true }); assert.equal(f.interaction.state.get().selectedIds.length, 3)
  } finally { f.close() }
  const framed = await fixture([shape('frame', 750, 100, { shapeType: 'frame', props: { w: 300, h: 300 } }), shape('child', 50, 70, { parentId: 'shape:frame', props: { w: 60, h: 40 } })])
  try {
    framed.interaction.select('all'); assert.deepEqual(framed.interaction.state.get().selectedIds, ['shape:frame'])
    await framed.interaction.runAction('fit-frame')
    const r = framed.session.store.get('shape:frame'); assert.deepEqual([r.x, r.y, r.props.w, r.props.h], [750, 120, 160, 140])
    await framed.key('f', { metaKey: true, shiftKey: true }); assert.deepEqual(framed.interaction.state.get().selectedIds, ['shape:child'])
    assert.equal(framed.session.store.get('shape:child').x, 800)
    await framed.session.undo(); assert.ok(framed.session.store.has('shape:frame'))
  } finally { framed.close() }
})

test('空目标与无净变化不提交；保存失败恢复原选择且后续可操作', async () => {
  const f = await selectionFixture([shape('a', 100, 100)], { beforeCommit: () => { throw new Error('synthetic offline') } })
  try {
    assert.equal((await f.interaction.runAction('delete')).reason, 'unavailable')
    await f.click(120, 120)
    assert.equal((await f.interaction.runAction('reorder-front')).status, 'unchanged')
    assert.equal(f.commits.length, 0); assert.equal(f.session.state.get().isGestureActive, false)
    await assert.rejects(f.interaction.runAction('delete'), /synthetic offline/)
    assert.deepEqual(f.selected(), ['shape:a']); assert.deepEqual(f.current(), f.initial)
    assert.equal(f.session.state.get().isSubmitting, false)
  } finally { f.close() }
})

test('裁剪模式拒绝动作，不影响当前裁剪；水平线仍可用对象放大', async () => {
  const f = await fixture([], createImageGallery(undefined, true).snapshot)
  try {
    f.interaction.cropImage({ type: 'start', id: 'shape:image-0' })
    assert.equal((await f.interaction.runAction('delete')).reason, 'cropping')
    assert.equal(f.interaction.state.get().croppingId, 'shape:image-0'); assert.equal(f.commits.length, 0)
  } finally { f.close() }
  const line = await fixture([{ type: 'put', record: { id: 'shape:line', typeName: 'shape', type: 'line', parentId: 'page:page', index: 'a1', x: 100, y: 100, rotation: 0, isLocked: false, opacity: 1, meta: {}, props: { color: 'black', dash: 'solid', size: 'm', scale: 1, spline: 'line', points: { a: { id: 'a', index: 'a1', x: 0, y: 0 }, b: { id: 'b', index: 'a2', x: 100, y: 0 } } } } }])
  try { line.interaction.select('all'); assert.equal((await line.interaction.runAction('enlarge')).status, 'applied'); assert.ok(Math.abs(line.session.store.get('shape:line').props.points.b.x - 110) < 1e-9) }
  finally { line.close() }
})

for (const kind of ['move', 'resize', 'draw']) test(`B27 ${kind} 活动中 Enter 不提前完成，松手才提交`, async () => {
  const f = await selectionFixture([shape('a', 100, 100)], { toolIds: ['select', 'draw'] })
  try {
    await f.click(120, 120)
    if (kind === 'draw') f.interaction.setTool('draw')
    const start = kind === 'resize' ? { x: 180, y: 160 } : { x: 130, y: 130 }
    f.pointer('down', start.x, start.y); f.pointer('move', start.x + 40, start.y + 30)
    const active = f.state().mode
    f.input({ type: 'key_down', key: 'Enter' }); assert.equal(f.state().mode, active); assert.equal(f.commits.length, 0)
    await f.pointer('up', start.x + 40, start.y + 30); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})
