import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawFixture } from './draw-fixture.mjs'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { getConnectionGeometry, createConnectionContext } from '../renderer/geometry.js'

const geo = (id, x = 100, y = 100, props = {}, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { w: 100, h: 80, fill: 'solid', ...props }, ...extra })
const fixture = (commands = [], options = {}) => drawFixture(commands, { toolIds: ['select', 'hand', 'draw', 'highlight', 'eraser'], ...options })
const ids = f => f.session.store.allRecords().filter(r => r.typeName === 'shape').map(r => r.id).sort()

test('E进入橡皮；按下只淡化多层，松手一次删除，整次撤销重做', async () => {
  const f = await fixture([geo('back'), geo('front', 120, 110)])
  try {
    f.key('e'); assert.equal(f.state().toolId, 'eraser')
    const before = f.session.store.getStoreSnapshot()
    f.pointer('down', 150, 130)
    assert.deepEqual(f.state().erasingIds, ['shape:back', 'shape:front'])
    assert.deepEqual(f.session.store.getStoreSnapshot(), before)
    assert.equal(f.session.state.get().isGestureActive, true)
    assert.equal(f.commits.length, 0); assert.equal(f.depth(), 0)
    await f.pointer('up', 150, 130)
    assert.deepEqual(ids(f), []); assert.equal(f.commits.length, 1); assert.equal(f.depth(), 1)
    assert.equal(f.commits[0].commands.filter(c => c.type === 'delete').length, 1)
    assert.deepEqual(f.state().erasingIds, []); assert.equal(f.state().mode, 'idle')
    await f.key('z', { metaKey: true }); assert.deepEqual(ids(f), ['shape:back', 'shape:front'])
    await f.key('z', { metaKey: true, shiftKey: true }); assert.deepEqual(ids(f), [])
  } finally { f.close() }
})

for (const mod of ['metaKey', 'ctrlKey']) test(`${mod}点按仅顶层；越过4屏幕像素后按整段累积多层，途中不读全板`, async () => {
  const f = await fixture([geo('back'), geo('front', 120, 110), geo('far', 400, 100)])
  try {
    f.key('e'); f.pointer('down', 150, 130, { [mod]: true })
    assert.deepEqual(f.state().erasingIds, ['shape:front'])
    f.pointer('move', 154, 130, { [mod]: true }); assert.equal(f.state().mode, 'pointing')
    const original = f.session.store.allRecords, snapshot = f.session.store.getStoreSnapshot
    f.session.store.allRecords = f.session.store.getStoreSnapshot = () => { throw Error('移动读取了全板') }
    try {
      f.pointer('move', 155, 130, { [mod]: true })
      assert.deepEqual(f.state().erasingIds, ['shape:back', 'shape:front'])
      f.pointer('move', 550, 130, { [mod]: true })
      assert.deepEqual(f.state().erasingIds, ['shape:back', 'shape:far', 'shape:front'])
    } finally { f.session.store.allRecords = original; f.session.store.getStoreSnapshot = snapshot }
    await f.pointer('up', 550, 130, { [mod]: true })
    assert.deepEqual(ids(f), []); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

for (const end of ['Escape', 'cancel', 'form', 'blur', 'tool', 'camera', 'dispose']) test(`擦除途中通过${end}取消，保留文档与选区，不占撤销一步`, async () => {
  const f = await fixture([geo('a'), geo('b', 400)])
  try {
    f.pointer('down', 150, 130); await f.pointer('up', 150, 130)
    const selected = [...f.state().selectedIds], before = f.session.store.getStoreSnapshot()
    f.key('e'); f.pointer('down', 150, 130); f.pointer('move', 550, 130)
    if (end === 'Escape') f.key('Escape')
    if (end === 'cancel') f.pointer('cancel', 550, 130)
    if (end === 'form') f.interaction.setInputContext({ owner: 'form' })
    if (end === 'blur') { f.pointer('cancel', 550, 130); f.interaction.setInputContext({ owner: 'form' }) }
    if (end === 'tool') f.interaction.setTool('hand')
    if (end === 'camera') f.interaction.setCamera({ x: 10, y: 10, z: 2 })
    if (end === 'dispose') f.interaction.dispose()
    else await f.pointer('up', 550, 130)
    assert.deepEqual(f.session.store.getStoreSnapshot(), before); assert.equal(f.commits.length, 0); assert.equal(f.depth(), 0)
    assert.deepEqual(f.state().selectedIds, selected); assert.deepEqual(f.state().erasingIds, [])
    assert.equal(f.state().eraser, null)
  } finally { f.close() }
})

test('E受toolIds/输入归属/禁用控制；橡皮idle Esc保持工具与选区', async () => {
  const f = await fixture([geo('a')])
  try {
    f.pointer('down', 150, 130); await f.pointer('up', 150, 130)
    const selected = [...f.state().selectedIds]
    for (const context of [{ owner: 'form' }, { owner: 'canvas', isComposing: true }]) {
      f.interaction.setInputContext(context); f.key('e'); assert.equal(f.state().toolId, 'select')
    }
    f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setShortcutsEnabled(false)
    f.key('e'); assert.equal(f.state().toolId, 'select')
    f.interaction.setShortcutsEnabled(true); f.key('e'); f.key('Escape')
    assert.equal(f.state().toolId, 'eraser'); assert.deepEqual(f.state().selectedIds, selected)
  } finally { f.close() }
  const limited = await fixture([], { toolIds: ['select'] })
  try { limited.key('e'); assert.equal(limited.state().toolId, 'select') } finally { limited.close() }
})

test('灰色擦除描述只放会话；尾迹有界、停住剩末点、松手短暂收尾后清理', async () => {
  const f = await fixture([geo('a')])
  try {
    f.key('e'); f.pointer('down', 50, 130); f.pointer('move', 160, 130)
    assert.equal(f.state().eraser.kind, 'eraser'); assert.deepEqual(f.state().eraser.ids, ['shape:a'])
    for (let i = 0; i < 300; i++) f.pointer('move', 160 + i, 130)
    assert.ok(f.state().eraser.points.length <= 128)
    f.input({ type: 'frame', time: 1000 }); assert.equal(f.state().eraser.points.length, 1)
    await f.pointer('up', 460, 130); assert.deepEqual(f.state().erasingIds, [])
    assert.ok(f.state().eraser.points.length); assert.deepEqual(f.state().eraser.ids, [])
    f.input({ type: 'frame', time: 1200 }); assert.equal(f.state().eraser, null)
    assert.ok(!JSON.stringify(f.saved()).includes('erasingIds'))
  } finally { f.close() }
})

for (const hitLocked of [true, false]) test(`组级联：${hitLocked ? '直接命中锁住的子对象跳过' : '命中未锁子对象删除整组及锁住兄弟'}`, async () => {
  const f = await fixture([geo('left'), geo('right', 300), { type: 'group_shapes', ids: ['shape:left', 'shape:right'], groupId: 'shape:group' }, { type: 'update', id: 'shape:left', changes: { isLocked: true } }])
  try {
    f.key('e'); f.pointer('down', hitLocked ? 150 : 350, 130)
    assert.deepEqual(f.state().erasingIds, hitLocked ? [] : ['shape:group'])
    await f.pointer('up', hitLocked ? 150 : 350, 130)
    assert.deepEqual(ids(f), hitLocked ? ['shape:group', 'shape:left', 'shape:right'] : [])
    assert.equal(f.commits.length, hitLocked ? 0 : 1)
    if (!hitLocked) { await f.key('z', { metaKey: true }); assert.equal(f.session.store.get('shape:left').isLocked, true) }
  } finally { f.close() }
})

test('透明对象可擦，锁定根/祖先不可擦且不挡住未锁下层', async () => {
  const f = await fixture([geo('back'), geo('transparent'), geo('locked'), { type: 'update', id: 'shape:transparent', changes: { opacity: 0 } }, { type: 'update', id: 'shape:locked', changes: { isLocked: true } },
    geo('left', 400), geo('right', 600), { type: 'group_shapes', ids: ['shape:left', 'shape:right'], groupId: 'shape:group' }, { type: 'update', id: 'shape:group', changes: { isLocked: true } }])
  try {
    f.key('e'); f.pointer('down', 150, 130)
    assert.deepEqual(f.state().erasingIds, ['shape:back', 'shape:transparent'])
    f.pointer('move', 750, 130); assert.deepEqual(f.state().erasingIds, ['shape:back', 'shape:transparent'])
    await f.pointer('up', 750, 130)
    assert.deepEqual(ids(f), ['shape:group', 'shape:left', 'shape:locked', 'shape:right'])
  } finally { f.close() }
})

test('聚焦组只擦子对象；取消保留选区，删除撤销恢复作品但不恢复选区', async () => {
  const f = await fixture([geo('left'), geo('right', 300), { type: 'group_shapes', ids: ['shape:left', 'shape:right'], groupId: 'shape:group' }])
  try {
    f.pointer('down', 150, 130); await f.pointer('up', 150, 130); f.interaction.select('enter')
    assert.equal(f.state().focusedGroupId, 'shape:group')
    f.key('e'); f.pointer('down', 150, 130); assert.deepEqual(f.state().erasingIds, ['shape:left'])
    await f.pointer('up', 150, 130); await f.key('z', { metaKey: true })
    assert.deepEqual(ids(f), ['shape:group', 'shape:left', 'shape:right'])
    assert.ok(!f.state().selectedIds.includes('shape:left'))
  } finally { f.close() }
})

for (const overlap of [false, true]) test(`擦除待提交时远端${overlap ? '改命中对象则取消' : '改无关对象仍可整次删除'}，保留远端数据`, async () => {
  const f = await fixture([geo('a'), geo('b', 400)])
  try {
    f.key('e'); f.pointer('down', 150, 130)
    await f.remote([{ type: 'update', id: overlap ? 'shape:a' : 'shape:b', changes: { x: 700 } }])
    if (overlap) await assert.rejects(async () => f.pointer('up', 150, 130), /改变|冲突/)
    else await f.pointer('up', 150, 130)
    assert.equal(f.session.store.get(overlap ? 'shape:a' : 'shape:b').x, 700)
    assert.equal(f.commits.length, overlap ? 0 : 1)
    assert.deepEqual(f.state().erasingIds, [])
  } finally { f.close() }
})

for (const savedBeforeError of [false, true]) test(`删除请求${savedBeforeError ? '已保存但响应丢失' : '网络失败未保存'}，只重读不重复删除，清除会话预览`, async () => {
  let snapshot = executeCanvasCommands(createCanvasSnapshot(), [geo('a')]).snapshot, revision = 0, calls = 0
  const session = await createEditorSession({ actor: 'eraser-network', transport: {
    read: async () => ({ snapshot, revision: String(revision) }), subscribe: () => () => {},
    commit: async request => {
      calls++
      if (savedBeforeError) { snapshot = executeCanvasCommands(snapshot, request.commands).snapshot; revision++ }
      throw Object.assign(new Error('合成网络断开'), { code: 'transport' })
    },
  } })
  const interaction = createCanvasInteraction({ session, toolIds: ['select', 'eraser'], edgeScrolling: false })
  const pointer = type => interaction.dispatch({ type: `pointer_${type}`, point: { x: 150, y: 130 }, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, time: type === 'up' ? 3 : 2 })
  try {
    interaction.setTool('eraser'); pointer('down')
    await assert.rejects(pointer('up'), /网络/)
    assert.equal(calls, 1); assert.equal(Boolean(session.store.get('shape:a')), !savedBeforeError)
    assert.equal(session.state.get().isGestureActive, false); assert.equal(session.state.get().isSubmitting, false)
    assert.deepEqual(interaction.state.get().erasingIds, []); assert.equal(interaction.state.get().eraser, null)
  } finally { interaction.dispose(); session.dispose() }
})

test('擦除绑定目标保留箭头可见端点；一次撤销同时恢复目标、绑定和端点', async () => {
  const f = await fixture([geo('target', 400, 100),
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 100, y: 140, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 } } },
    { type: 'put', record: { id: 'binding:end', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:target', props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: true, isPrecise: true, snap: 'none' }, meta: {} } },
    { type: 'update', id: 'shape:target', changes: { x: 500 } },
  ])
  try {
    const before = f.session.store.getStoreSnapshot(), arrow = f.session.store.get('shape:arrow')
    const tip = getConnectionGeometry(arrow, createConnectionContext(f.session.store.allRecords())).path.at(1)
    f.key('e'); f.pointer('down', 570, 130); await f.pointer('up', 570, 130)
    assert.equal(f.session.store.get('shape:target'), undefined); assert.equal(f.session.store.get('binding:end'), undefined)
    assert.deepEqual(f.session.store.get('shape:arrow').props.end, tip); assert.equal(f.commits.length, 1)
    await f.key('z', { metaKey: true }); assert.deepEqual(f.session.store.getStoreSnapshot(), before)
  } finally { f.close() }
})

for (const mutation of ['new-child', 'child-change', 'new-binding']) test(`已命中组在松手前收到${mutation}，拒绝扩大擦除范围`, async () => {
  const f = await fixture([geo('a'), geo('b', 300), { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:group' },
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 700, y: 400 }])
  try {
    f.key('e'); f.pointer('down', 150, 130)
    const commands = mutation === 'new-child' ? [geo('remote', 450, 100, {}, { parentId: 'shape:group' })]
      : mutation === 'child-change' ? [{ type: 'update', id: 'shape:b', changes: { x: 700 } }]
        : [{ type: 'put', record: { id: 'binding:remote', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:b', props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: true, isPrecise: true, snap: 'none' }, meta: {} } }]
    await f.remote(commands)
    const confirmed = f.session.store.getStoreSnapshot()
    await assert.rejects(async () => f.pointer('up', 150, 130), /改变|冲突/)
    assert.deepEqual(f.session.store.getStoreSnapshot(), confirmed); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
