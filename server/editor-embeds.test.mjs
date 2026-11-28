import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasInteraction, createEditorSession, executeCanvasCommands } from '../engine/index.js'
import { memoryHost } from './fixtures/editor-session-fixture.mjs'
import { parseExternalClipboard } from '../tools/renderer-preview/clipboard-external.js'
import { memoryTransport } from '../tools/renderer-preview/transport.js'
import { createCanvasSnapshot } from '../model/index.js'
import { createVideoFixture } from '../tools/renderer-preview/video-fixtures.js'
import { attachPreviewInput } from '../tools/renderer-preview/input.js'

async function editor(t, clipboard) {
  const host = memoryHost(), session = await createEditorSession({ transport: host.transport, actor: 'ui:embeds' })
  const ui = createCanvasInteraction({ session, camera: { x: -200, y: -100, z: 2 }, viewport: { w: 1000, h: 700 }, clipboard })
  t.after(() => { ui.dispose(); session.dispose() })
  return { host, session, ui }
}

test('G01服务选择、返回、坏地址和取消不写文档，合法网址只提交一次到page中心', async t => {
  const { host, session, ui } = await editor(t)
  ui.embed({ type: 'open' })
  assert.equal(ui.state.get().embedEditing.serviceId, null)
  ui.embed({ type: 'service', serviceId: 'G13' })
  ui.embed({ type: 'update', url: 'javascript:alert(1)' })
  assert.equal(ui.state.get().embedEditing.valid, false)
  await assert.rejects(ui.embed({ type: 'submit' }))
  ui.embed({ type: 'back' }); ui.embed({ type: 'service', serviceId: 'G06' }); ui.embed({ type: 'cancel' })
  assert.equal(host.commits.length, 0)
  assert.equal(ui.state.get().embedEditing, null)
  ui.embed({ type: 'open' }); ui.embed({ type: 'service', serviceId: 'G13' }); ui.embed({ type: 'update', url: 'https://youtu.be/demo?t=73' })
  assert.equal(ui.state.get().embedEditing.valid, true)
  await ui.embed({ type: 'submit' })
  assert.equal(host.commits.length, 1)
  assert.equal(host.commits[0].commands[0].type, 'insert_url')
  const shape = session.store.get(ui.state.get().selectedIds[0])
  assert.deepEqual([shape.x, shape.y, shape.props.w, shape.props.h], [50, 50, 800, 450])
  assert.equal(ui.state.get().embedEditing, null)
})

test('网址插入的形状与书签资源随同一次历史撤销/重做恢复', async t => {
  const transport = memoryTransport(createCanvasSnapshot()), session = await createEditorSession({ transport, actor: 'ui:history' })
  const ui = createCanvasInteraction({ session, viewport: { w: 1000, h: 700 }, clipboard: { read: async () => parseExternalClipboard({ 'text/plain': 'https://example.invalid' }) } })
  t.after(() => { ui.dispose(); session.dispose() })
  const initial = structuredClone(session.store.getStoreSnapshot())
  await ui.runAction('paste')
  const shape = session.store.get(ui.state.get().selectedIds[0]), asset = session.store.get(shape.props.assetId)
  const pasted = structuredClone(session.store.getStoreSnapshot())
  await session.undo(); assert.equal(session.store.has(shape.id), false); assert.equal(session.store.has(asset.id), false)
  assert.deepEqual(session.store.getStoreSnapshot(), initial)
  await session.redo(); assert.deepEqual(session.store.get(shape.id), shape); assert.deepEqual(session.store.get(asset.id), asset)
  assert.deepEqual(session.store.getStoreSnapshot(), pasted)
  assert.equal(transport.getCommitCount(), 1)
})

test('公开互转动作捕获明确对象/版本/选择，单命令保留选择；过期意图零提交', async t => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:embed', shapeType: 'embed', props: { url: 'https://youtu.be/demo', w: 480, h: 270 } },
  ]).snapshot
  const host = memoryHost(initial), session = await createEditorSession({ transport: host.transport, actor: 'ui:convert' })
  const ui = createCanvasInteraction({ session, viewport: { w: 1000, h: 700 } })
  t.after(() => { ui.dispose(); session.dispose() })
  ui.select('all')
  const intent = ui.embed({ type: 'conversion-intent', to: 'bookmark' })
  assert.equal(intent.id, 'shape:embed')
  assert.ok(Object.isFrozen(intent))
  ui.select('clear')
  await assert.rejects(ui.embed(intent), error => error.code === 'conflict')
  assert.equal(host.commits.length, 0)
  ui.select('all')
  const stale = ui.embed({ type: 'conversion-intent', to: 'bookmark' })
  await host.remote([{ type: 'update', id: 'shape:embed', changes: { opacity: .5 } }]); await session.refresh()
  await assert.rejects(ui.embed(stale), error => error.code === 'conflict')
  assert.equal(host.commits.filter(row => row.actor === 'ui:convert').length, 0)
  const current = ui.embed({ type: 'conversion-intent', to: 'bookmark' })
  await ui.embed(current)
  assert.deepEqual(ui.state.get().selectedIds, ['shape:embed'])
  assert.equal(session.store.get('shape:embed').type, 'bookmark')
  assert.equal(session.store.get('shape:embed').opacity, .5)
  assert.deepEqual(host.commits.filter(row => row.actor === 'ui:convert').map(row => row.commands), [[{ type: 'convert_url_shape', id: 'shape:embed', to: 'bookmark' }]])
  ui.setInputContext({ owner: 'canvas', isComposing: true })
  assert.equal(ui.embed({ type: 'conversion-intent', to: 'embed' }), null)
  ui.setInputContext({ owner: 'canvas' })
  await ui.embed(ui.embed({ type: 'conversion-intent', to: 'embed' }))
  assert.equal(session.store.get('shape:embed').type, 'embed')
})

test('Mod+I沿统一按键表：画布可开，表单/菜单/组字/禁快捷键/连发/Shift/Alt不抢占', async t => {
  const { ui } = await editor(t)
  let time = 0
  const key = extra => ui.dispatch({ type: 'key_down', key: 'i', code: 'KeyI', metaKey: true, time: ++time, ...extra })
  for (const owner of ['form', 'menu', 'text-editing']) { ui.setInputContext({ owner }); assert.equal(key(), false); assert.equal(ui.state.get().embedEditing, undefined) }
  ui.setInputContext({ owner: 'canvas', isComposing: true }); key(); assert.equal(ui.state.get().embedEditing, undefined)
  ui.setInputContext({ owner: 'canvas' }); ui.setShortcutsEnabled(false); key(); assert.equal(ui.state.get().embedEditing, undefined)
  ui.setShortcutsEnabled(true)
  for (const extra of [{ repeat: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) { key(extra); assert.equal(ui.state.get().embedEditing, undefined) }
  assert.equal(key(), true); assert.equal(ui.state.get().embedEditing.serviceId, null)
  ui.dispatch({ type: 'key_down', key: 'Escape', time: ++time }); assert.equal(ui.state.get().embedEditing, null)
})

test('打开门禁与提交前版本/选择校验阻止组字、编辑或迟到意图', async t => {
  const { host, session, ui } = await editor(t)
  ui.setInputContext({ owner: 'canvas', isComposing: true })
  assert.throws(() => ui.embed({ type: 'open' }))
  ui.setInputContext({ owner: 'canvas' }); ui.embed({ type: 'open' }); ui.embed({ type: 'service', serviceId: 'G13' }); ui.embed({ type: 'update', url: 'https://youtu.be/demo' })
  await host.remote([{ type: 'create_shape', shapeType: 'geo', id: 'shape:remote' }]); await session.refresh()
  await assert.rejects(ui.embed({ type: 'submit' }), error => error.code === 'conflict')
  assert.equal(host.commits.filter(row => row.actor === 'ui:embeds').length, 0)
  ui.embed({ type: 'cancel' }); ui.embed({ type: 'open' }); ui.embed({ type: 'service', serviceId: 'G13' }); ui.embed({ type: 'update', url: 'https://youtu.be/demo' })
  ui.select('all')
  await assert.rejects(ui.embed({ type: 'submit' }), error => error.code === 'conflict')
  assert.equal(host.commits.filter(row => row.actor === 'ui:embeds').length, 0)
})

test('嵌入表单里的Enter保留原生按钮语义，不抢走返回或取消焦点创建文档', async t => {
  const { host, ui } = await editor(t)
  ui.embed({ type: 'open' }); ui.embed({ type: 'service', serviceId: 'G13' }); ui.embed({ type: 'update', url: 'https://youtu.be/demo' })
  ui.setInputContext({ owner: 'menu' })
  await ui.dispatch({ type: 'key_down', key: 'Enter', time: 1 })
  assert.equal(host.commits.length, 0)
  assert.equal(ui.state.get().embedEditing.valid, true)
  ui.embed({ type: 'cancel' })
  assert.equal(ui.state.get().embedEditing, null)
})

test('网址粘贴复用原异步门禁与一条paste命令；Esc或离开焦点后迟到结果零提交', async t => {
  for (const cancelled of [false, 'escape', 'focus']) {
    let resolve, started
    const wait = new Promise(r => { resolve = r }), entered = new Promise(r => { started = r })
    const { host, ui } = await editor(t, { read() { started(); return wait } })
    const pending = ui.runAction('paste'); await entered
    if (cancelled === 'escape') ui.dispatch({ type: 'key_down', key: 'Escape', time: 1 })
    if (cancelled === 'focus') ui.setInputContext({ owner: 'form' })
    resolve(parseExternalClipboard({ 'text/plain': 'https://youtu.be/demo' }))
    if (cancelled) { await assert.rejects(pending, error => error.code === 'conflict'); assert.equal(host.commits.length, 0) }
    else { await pending; assert.equal(host.commits.length, 1); assert.equal(host.commits[0].commands[0].type, 'paste_content') }
  }
})

async function interactionFixture(t, extra = [], history = false) {
  const initial = executeCanvasCommands(createVideoFixture().snapshot, [
    { type: 'create_shape', id: 'shape:embed-a', shapeType: 'embed', x: 1350, y: 80, props: { url: 'https://youtu.be/demo', w: 480, h: 270 } },
    { type: 'create_shape', id: 'shape:embed-b', shapeType: 'embed', x: 1350, y: 500, props: { url: 'https://vimeo.com/123456', w: 480, h: 270 } },
    { type: 'create_shape', id: 'shape:unknown', shapeType: 'embed', x: 1800, y: 80, props: { url: 'https://unknown.example.invalid', w: 300, h: 250 } },
    ...extra,
  ]).snapshot
  const host = memoryHost(initial), transport = history ? memoryTransport(initial) : host.transport
  const session = await createEditorSession({ transport, actor: 'ui:embed-interaction' })
  const ui = createCanvasInteraction({ session, camera: { x: 0, y: 0, z: 1 }, viewport: { w: 2200, h: 1000 }, edgeScrolling: false })
  t.after(() => { ui.dispose(); session.dispose() })
  let time = 0
  const input = value => ui.dispatch({ time: ++time, ...value })
  const pointer = (type, x = 1550, y = 200) => input({ type: `pointer_${type}`, point: { x, y }, button: 0, buttons: type === 'up' ? 0 : 1, pointerId: 1 })
  const click = async (x = 1550, y = 200) => { pointer('down', x, y); await pointer('up', x, y) }
  const begin = (id = 'shape:embed-a') => ui.embed({ type: 'interact', id })
  const active = () => ui.state.get().interactingEmbedId
  const document = () => structuredClone(session.store.getStoreSnapshot())
  return { host, transport, session, ui, input, pointer, click, begin, active, document, gap: () => { time += 1000 } }
}

test('#206 两次真实点击进入会话互动，单次点击不进入且文档版本/提交/手势不变', async t => {
  const f = await interactionFixture(t), before = f.document(), revision = f.session.state.get().revision
  await f.click(); assert.equal(f.active(), null)
  await f.click(); assert.equal(f.active(), 'shape:embed-a')
  assert.equal(f.session.state.get().isGestureActive, false)
  f.ui.embed({ type: 'finish-interaction' }); assert.equal(f.active(), null)
  assert.deepEqual(f.document(), before); assert.equal(f.session.state.get().revision, revision); assert.equal(f.host.commits.length, 0)
})

test('#206 第二击按住越过拖动门槛只移动对象，不短暂进入iframe互动', async t => {
  const f = await interactionFixture(t), old = f.session.store.get('shape:embed-a')
  await f.click(); f.pointer('down'); f.pointer('move', 1590, 230)
  assert.equal(f.active(), null)
  await f.pointer('up', 1590, 230)
  assert.equal(f.active(), null)
  const current = f.session.store.get(old.id)
  assert.ok(current.x !== old.x || current.y !== old.y)
  assert.equal(f.host.commits.length, 1)
})

test('#206 无效目标不能清掉有效互动；换嵌入原子交接且没有文档写入', async t => {
  const f = await interactionFixture(t), before = f.document()
  assert.equal(f.begin(), true)
  for (const id of ['shape:missing', 'shape:unknown', 'shape:video-0', 'shape:video-unrelated']) {
    assert.equal(f.begin(id), false); assert.equal(f.active(), 'shape:embed-a')
  }
  assert.equal(f.begin('shape:embed-b'), true)
  assert.equal(f.active(), 'shape:embed-b'); assert.equal(f.ui.state.get().interactingVideoId, null)
  assert.deepEqual(f.ui.state.get().selectedIds, ['shape:embed-b'])
  assert.deepEqual(f.document(), before); assert.equal(f.host.commits.length, 0)
})

test('#206 iframe焦点的form上下文保留互动并保护所有画布键；父画布Esc只退出一次', async t => {
  const f = await interactionFixture(t), before = f.document()
  f.begin(); f.ui.setInputContext({ owner: 'form' })
  assert.equal(f.active(), 'shape:embed-a')
  for (const key of ['Escape', 'Delete', 'ArrowRight', 'h', ' ', 'z']) {
    assert.equal(f.input({ type: 'key_down', key }), false)
    f.input({ type: 'key_up', key }); assert.equal(f.active(), 'shape:embed-a')
  }
  f.ui.setInputContext({ owner: 'canvas' })
  assert.equal(f.input({ type: 'key_down', key: 'Escape' }), true)
  assert.equal(f.active(), null); assert.deepEqual(f.ui.state.get().selectedIds, ['shape:embed-a'])
  assert.deepEqual(f.document(), before); assert.equal(f.host.commits.length, 0)
})

test('#206 与 #209：焦点停在框外退出按钮等非输入控件上时，Esc 也只退出互动一次并保留选择', async t => {
  for (const owner of ['toolbar-button', 'button']) {
    const f = await interactionFixture(t), before = f.document()
    f.begin(); f.ui.setInputContext({ owner })
    assert.equal(f.input({ type: 'key_down', key: 'Escape' }), true, owner)
    assert.equal(f.active(), null, owner); assert.deepEqual(f.ui.state.get().selectedIds, ['shape:embed-a'], owner)
    assert.deepEqual(f.document(), before); assert.equal(f.host.commits.length, 0)
  }
})

test('#206 IME的context/event/229都不能把Esc送给互动或从双击进入', async t => {
  for (const source of ['context', 'event', '229']) {
    const f = await interactionFixture(t)
    f.begin()
    if (source === 'context') f.ui.setInputContext({ owner: 'canvas', isComposing: true })
    f.input({ type: 'key_down', key: 'Escape', ...(source === 'event' ? { isComposing: true } : source === '229' ? { keyCode: 229 } : {}) })
    assert.equal(f.active(), 'shape:embed-a')
    f.ui.embed({ type: 'finish-interaction' })
    f.ui.setInputContext({ owner: 'canvas', isComposing: true })
    await f.click(); await f.click(); assert.equal(f.active(), null)
    assert.equal(f.host.commits.length, 0)
  }
})

test('#206 点击框外退出后，同一次点击仍选择新对象；换工具和换选择退出', async t => {
  const f = await interactionFixture(t)
  f.begin(); await f.click(950, 130)
  assert.equal(f.active(), null); assert.deepEqual(f.ui.state.get().selectedIds, ['shape:video-unrelated'])
  f.begin(); f.ui.setTool('hand'); assert.equal(f.active(), null)
  f.ui.setTool('select'); f.begin(); f.ui.select('clear'); assert.equal(f.active(), null)
  assert.equal(f.host.commits.length, 0)
})

test('#206 相机和视口变化、无关远端修改保持互动；相关远端修改逐项退出', async t => {
  const f = await interactionFixture(t)
  f.begin(); f.ui.setCamera({ x: -60, y: -80, z: .75 }); f.ui.setViewport({ w: 1800, h: 900 })
  assert.equal(f.active(), 'shape:embed-a')
  await f.host.remote([{ type: 'update', id: 'shape:video-unrelated', changes: { x: 1000 } }]); await f.session.refresh()
  assert.equal(f.active(), 'shape:embed-a')
  for (const changes of [{ x: 1360 }, { rotation: .1 }, { opacity: .8 }, { props: { url: 'https://youtu.be/changed' } }]) {
    f.begin(); await f.host.remote([{ type: 'update', id: 'shape:embed-a', changes }]); await f.session.refresh()
    assert.equal(f.active(), null)
  }
  assert.equal(f.host.commits.filter(row => row.actor === 'ui:embed-interaction').length, 0)
})

test('#206 锁定、隐藏、删除目标立即结束；无效目标不能重新进入', async t => {
  for (const changes of [{ isLocked: true }, { opacity: 0 }, null]) {
    const f = await interactionFixture(t); f.begin()
    await f.host.remote(changes ? [{ type: 'update', id: 'shape:embed-a', changes }] : [{ type: 'delete', ids: ['shape:embed-a'] }]); await f.session.refresh()
    assert.equal(f.active(), null); assert.equal(f.begin(), false)
  }
})

test('#206 已聚焦组的嵌入可互动；父链移动/锁定/隐藏/删除均结束互动', async t => {
  for (const changes of [{ x: 100 }, { isLocked: true }, { opacity: 0 }, null]) {
    const f = await interactionFixture(t, [{ type: 'group_shapes', ids: ['shape:embed-a', 'shape:embed-b'], groupId: 'shape:embed-group' }])
    await f.click(); await f.click()
    assert.equal(f.active(), null); assert.equal(f.ui.state.get().focusedGroupId, 'shape:embed-group')
    f.gap(); await f.click(); await f.click(); assert.equal(f.active(), 'shape:embed-a')
    await f.host.remote(changes ? [{ type: 'update', id: 'shape:embed-group', changes }] : [{ type: 'delete', ids: ['shape:embed-group'] }]); await f.session.refresh()
    assert.equal(f.active(), null)
  }
})

test('#206 视频和嵌入互动互斥，视频后台播放及进度不被嵌入入口改变', async t => {
  const f = await interactionFixture(t), before = f.document()
  f.ui.videoInput({ type: 'playback', event: 'play', id: 'shape:video-0', assetId: 'asset:video-0', time: 1.25, playing: true })
  f.ui.videoInput({ type: 'start', id: 'shape:video-0' })
  f.begin(); assert.equal(f.active(), 'shape:embed-a'); assert.equal(f.ui.state.get().interactingVideoId, null)
  assert.deepEqual(f.ui.state.get().videoPlayback['shape:video-0'], { assetId: 'asset:video-0', time: 1.25, playing: true })
  f.ui.videoInput({ type: 'start', id: 'shape:video-0' })
  assert.equal(f.active(), null); assert.equal(f.ui.state.get().interactingVideoId, 'shape:video-0')
  assert.deepEqual(f.document(), before); assert.equal(f.host.commits.length, 0)
})

test('#206 G01、文字编辑、文档转换结束互动，undo只恢复文档不恢复会话', async t => {
  const f = await interactionFixture(t, [], true)
  f.begin(); f.ui.embed({ type: 'open' }); assert.equal(f.active(), null)
  f.ui.embed({ type: 'cancel' }); f.begin()
  f.ui.editText({ type: 'begin', id: 'shape:video-unrelated' }); assert.equal(f.active(), null)
  f.ui.editText({ type: 'cancel' }); f.ui.setInputContext({ owner: 'canvas' }); f.begin()
  await f.ui.embed(f.ui.embed({ type: 'conversion-intent', to: 'bookmark' }))
  assert.equal(f.active(), null); assert.equal(f.session.store.get('shape:embed-a').type, 'bookmark')
  await f.session.undo()
  assert.equal(f.session.store.get('shape:embed-a').type, 'embed'); assert.equal(f.active(), null)
})


test('#206 第二击只在松手带来新位置时仍按拖动处理，不误入互动', async t => {
  const f = await interactionFixture(t), before = f.session.store.get('shape:embed-a')
  await f.click(); f.pointer('down'); await f.pointer('up', 1590, 230)
  assert.equal(f.active(), null)
  assert.deepEqual([f.session.store.get(before.id).x, f.session.store.get(before.id).y], [before.x + 40, before.y + 30])
  assert.equal(f.host.commits.length, 1)
})

test('#206 生成内容、未知服务和组内未聚焦对象不能互动', async t => {
  const f = await interactionFixture(t, [
    { type: 'create_shape', id: 'shape:generated', shapeType: 'embed', props: { url: 'https://youtu.be/demo' }, meta: { cowartHtmlDraft: true } },
    { type: 'group_shapes', ids: ['shape:embed-b', 'shape:unknown'], groupId: 'shape:closed-group' },
  ])
  f.begin()
  for (const id of ['shape:generated', 'shape:unknown', 'shape:embed-b']) {
    assert.equal(f.begin(id), false, id); assert.equal(f.active(), 'shape:embed-a')
  }
  assert.equal(f.host.commits.length, 0)
})

test('#220 Gist复用双击互动和退出，状态不写文档且不占撤销', async t => {
  const f = await interactionFixture(t, [{ type: 'update', id: 'shape:embed-a', changes: { props: { url: 'https://gist.github.com/abc012' } } }])
  const before = f.document()
  await f.click(); assert.equal(f.active(), null)
  await f.click(); assert.equal(f.active(), 'shape:embed-a')
  f.input({ type: 'key_down', key: 'Escape' }); assert.equal(f.active(), null)
  assert.deepEqual(f.document(), before); assert.equal(f.host.commits.length, 0)
})

test('#206 加载代次仅由当前来源结束互动；退出/加载错误不提交且undo不复活', async t => {
  const f = await interactionFixture(t), before = f.document()
  f.begin()
  for (const event of [{ id: 'shape:embed-b', url: 'https://vimeo.com/123456' }, { id: 'shape:embed-a', url: 'https://youtu.be/old' }]) {
    f.ui.embed({ type: 'frame-load', ...event }); assert.equal(f.active(), 'shape:embed-a')
  }
  for (const type of ['frame-load', 'frame-error']) {
    f.ui.embed({ type, id: 'shape:embed-a', url: 'https://youtu.be/demo' }); assert.equal(f.active(), null)
    f.begin()
  }
  f.ui.embed({ type: 'finish-interaction' }); f.ui.embed({ type: 'finish-interaction' })
  assert.equal(f.active(), null); assert.deepEqual(f.document(), before); assert.equal(f.host.commits.length, 0)
})


test('#206 提交中和其他手势中拒绝新互动，无效请求保留旧的会话所有者', async t => {
  const f = await interactionFixture(t)
  f.begin()
  let release, entered
  const wait = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  f.host.beforeCommit(async () => { entered(); await wait })
  const saving = f.session.commitCommands([{ type: 'update', id: 'shape:video-unrelated', changes: { x: 960 } }])
  await started
  assert.equal(f.begin('shape:embed-b'), false); assert.equal(f.active(), 'shape:embed-a')
  release(); await saving
  assert.equal(f.active(), 'shape:embed-a')
  f.ui.embed({ type: 'finish-interaction' })
  f.pointer('down'); assert.equal(f.session.state.get().isGestureActive, true)
  assert.equal(f.begin('shape:embed-b'), false); assert.equal(f.active(), null)
  await f.pointer('up')
})

test('#206 宿主把iframe当form保护全部键，框外指针只退出而不抢焦点；卸载解除监听', async t => {
  const f = await interactionFixture(t), keys = new EventTarget(), host = new EventTarget(), errors = []
  const iframe = { closest: selector => selector.includes('[data-canvas-input-owner="embed"]') ? iframe : null }
  const outside = { closest: () => null }, exitButton = { closest: selector => selector === '[data-embed-action="finish-interaction"]' ? exitButton : null }
  const doc = { defaultView: keys, activeElement: host }
  host.ownerDocument = doc; host.clientWidth = 2200; host.clientHeight = 1000
  host.contains = node => node === host || node === iframe; host.closest = () => null
  const emit = (type, target, extra = {}) => {
    const event = new Event(type, { cancelable: true })
    for (const [key, value] of Object.entries({ target, ...extra })) Object.defineProperty(event, key, { value })
    keys.dispatchEvent(event); return event
  }
  const controls = attachPreviewInput(host, f.ui, { onError: error => errors.push(error.message) })
  t.after(() => controls.dispose())
  f.begin(); doc.activeElement = iframe; emit('focusin', iframe)
  assert.equal(f.ui.state.get().inputContext.owner, 'form'); assert.equal(f.active(), 'shape:embed-a')
  assert.equal(emit('keydown', iframe, { key: 'Escape' }).defaultPrevented, false)
  assert.equal(f.active(), 'shape:embed-a')
  emit('pointerdown', iframe); emit('pointerdown', exitButton); assert.equal(f.active(), 'shape:embed-a')
  doc.activeElement = outside
  assert.equal(emit('pointerdown', outside).defaultPrevented, false)
  assert.equal(f.active(), null); assert.equal(doc.activeElement, outside)
  controls.dispose(); f.begin(); emit('pointerdown', outside)
  assert.equal(f.active(), 'shape:embed-a'); assert.deepEqual(errors, []); assert.equal(f.host.commits.length, 0)
})
