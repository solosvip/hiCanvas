import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasInteraction, createEditorSession, executeCanvasCommands } from '../engine/index.js'
import { memoryHost } from './fixtures/editor-session-fixture.mjs'
import { parseExternalClipboard } from '../tools/renderer-preview/clipboard-external.js'
import { memoryTransport } from '../tools/renderer-preview/transport.js'
import { createCanvasSnapshot } from '../model/index.js'

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
