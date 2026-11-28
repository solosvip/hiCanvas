import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createCanvasInteraction, createEditorSession, executeCanvasCommands, createClipboardContent, encodeClipboardContent } from '../engine/index.js'
import { memoryTransport } from '../tools/renderer-preview/transport.js'
import { parseExternalClipboard } from '../tools/renderer-preview/clipboard-external.js'

const oldUrl = 'https://old.example.invalid/page', newUrl = 'https://new.example.invalid/page'
const tick = () => new Promise(resolve => setImmediate(resolve))
const snapshotOf = session => structuredClone(session.store.getStoreSnapshot())
async function setup(t, { clipboard, fetchMetadata, initial } = {}) {
  const snapshot = initial || executeCanvasCommands(createCanvasSnapshot(), [{ type: 'insert_url', id: 'shape:bookmark', url: oldUrl }]).snapshot
  const transport = memoryTransport(snapshot), session = await createEditorSession({ transport, actor: 'ui:bookmark-edit' }), calls = []
  const ui = createCanvasInteraction({ session, viewport: { w: 1000, h: 700 }, clipboard, bookmarkMetadata: { fetchMetadata: async (url, options) => {
    calls.push({ url, ...options }); return fetchMetadata ? fetchMetadata(url, options) : { title: '新标题', description: '新描述', url }
  } } })
  t.after(() => { ui.dispose(); session.dispose() })
  return { ui, session, transport, calls }
}

test('外部网址粘贴和嵌入转书签成功后自动补齐，内部内容与undo/redo不重新抓取', async t => {
  const { ui, session, transport, calls } = await setup(t, { initial: createCanvasSnapshot(), clipboard: { read: async () => parseExternalClipboard({ 'text/plain': oldUrl }) } })
  await ui.runAction('paste'); await tick()
  assert.equal(calls.length, 1)
  const target = session.store.get(ui.state.get().selectedIds[0])
  assert.equal(session.store.get(target.props.assetId).props.title, '新标题')
  assert.equal(transport.getCommitCount(), 2)
  await session.undo(); assert.equal(session.store.get(target.props.assetId).props.title, '')
  await session.redo(); await tick(); assert.equal(calls.length, 1)
  await session.commitCommands([{ type: 'insert_url', id: 'shape:embed', url: 'https://youtu.be/synthetic221' }])
  ui.select('all'); ui.select('clear')
  const input = (type, time) => ui.dispatch({ type, time, point: { x: 0, y: 0 }, button: 0, pointerId: 1 })
  input('pointer_down', 1); input('pointer_up', 2)
  // Both overlapping records exist; explicitly select the top embed by the
  // public selection order, without writing selection into the document.
  ui.select('all'); ui.select('next')
  const intent = ui.embed({ type: 'conversion-intent', to: 'bookmark' })
  assert.equal(intent?.id, 'shape:embed')
  await ui.embed(intent); await tick()
  assert.equal(calls.length, 2)
  assert.equal(session.store.get(session.store.get('shape:embed').props.assetId).props.title, '新标题')
})

test('改网址先读不写，成功后URL和信息一次保存，undo/redo逐字段恢复', async t => {
  let resolve
  const { ui, session, transport } = await setup(t, { fetchMetadata: () => new Promise(yes => { resolve = yes }) })
  ui.select('all')
  const before = snapshotOf(session)
  ui.bookmark({ type: 'open' }); ui.bookmark({ type: 'update', url: newUrl })
  ui.setInputContext({ owner: 'form' })
  const pending = ui.bookmark({ type: 'submit' })
  assert.deepEqual(snapshotOf(session), before); assert.equal(transport.getCommitCount(), 0)
  assert.equal(ui.state.get().bookmarkEditing.phase, 'fetching')
  resolve({ title: '新站标题', description: '新站描述', url: newUrl })
  assert.equal((await pending).status, 'applied')
  assert.equal(transport.getCommitCount(), 1); assert.equal(ui.state.get().bookmarkEditing, null)
  const after = snapshotOf(session), shape = session.store.get('shape:bookmark')
  assert.equal(shape.props.url, newUrl); assert.equal(session.store.get(shape.props.assetId).props.title, '新站标题')
  await session.undo(); assert.deepEqual(snapshotOf(session), before)
  await session.redo(); assert.deepEqual(snapshotOf(session), after)
})

test('私网拒绝不保存或回显正文，明确仅存网址才一事务保存并可undo', async t => {
  const { ui, session, transport } = await setup(t, { fetchMetadata: async () => { throw Object.assign(new Error('SECRET response body'), { code: 'target_not_public' }) } })
  ui.select('all'); const before = snapshotOf(session)
  ui.bookmark({ type: 'open' }); ui.bookmark({ type: 'update', url: 'http://127.0.0.1/local' })
  assert.equal((await ui.bookmark({ type: 'submit' })).status, 'failed')
  const draft = ui.state.get().bookmarkEditing
  assert.equal(draft.phase, 'failed'); assert.equal(draft.errorCode, 'target_not_public')
  assert.match(draft.error, /公开网络/); assert.doesNotMatch(draft.error, /SECRET/)
  assert.equal(transport.getCommitCount(), 0); assert.deepEqual(snapshotOf(session), before)
  assert.equal((await ui.bookmark({ type: 'save-url-only' })).status, 'applied')
  assert.equal(transport.getCommitCount(), 1); assert.equal(session.store.get('shape:bookmark').props.url, 'http://127.0.0.1/local')
  await session.undo(); assert.deepEqual(snapshotOf(session), before)
})

test('草稿取消/相同网址零写入，IME或form的Esc不抢；按钮焦点复用画布所有权', async t => {
  const { ui, session, transport, calls } = await setup(t)
  ui.select('all'); const before = snapshotOf(session)
  ui.bookmark({ type: 'open' }); await ui.bookmark({ type: 'submit' })
  assert.equal(ui.state.get().bookmarkEditing, null); assert.equal(calls.length, 0)
  ui.bookmark({ type: 'open' }); ui.bookmark({ type: 'update', url: newUrl })
  ui.setInputContext({ owner: 'form' }); ui.dispatch({ type: 'key_down', key: 'Escape', time: 1 })
  assert.ok(ui.state.get().bookmarkEditing)
  ui.setInputContext({ owner: 'toolbar-button', isComposing: true }); ui.dispatch({ type: 'key_down', key: 'Escape', time: 2 })
  assert.ok(ui.state.get().bookmarkEditing)
  ui.setInputContext({ owner: 'toolbar-button' }); ui.dispatch({ type: 'key_down', key: 'Escape', time: 3 })
  assert.equal(ui.state.get().bookmarkEditing, null)
  assert.deepEqual(snapshotOf(session), before); assert.equal(transport.getCommitCount(), 0)
})

test('内部复制的书签保持原信息，粘贴及历史不触发网络补齐', async t => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'insert_url', id: 'shape:original', url: oldUrl }]).snapshot
  const formats = encodeClipboardContent(createClipboardContent(initial, ['shape:original']))
  const { ui, session, calls, transport } = await setup(t, { initial, clipboard: { read: async () => formats } })
  await ui.runAction('paste'); await tick()
  assert.equal(calls.length, 0); assert.equal(transport.getCommitCount(), 1)
  assert.notEqual(ui.state.get().selectedIds[0], 'shape:original')
  await session.undo(); await session.redo(); await tick(); assert.equal(calls.length, 0)
})

test('改址已接纳但回执丢失时以宿主事实为准，退出草稿，不宣称未保存或仅存网址', async t => {
  const { ui, session, transport } = await setup(t)
  const commit = transport.commit
  transport.commit = async request => { await commit(request); throw new Error('lost acknowledgement') }
  ui.select('all'); ui.bookmark({ type: 'open' }); ui.bookmark({ type: 'update', url: newUrl })
  assert.equal((await ui.bookmark({ type: 'submit' })).status, 'failed')
  assert.equal(session.store.get('shape:bookmark').props.url, newUrl)
  assert.equal(transport.getCommitCount(), 1)
  assert.equal(ui.state.get().bookmarkEditing, null)
  assert.match(ui.state.get().lastNotice.message, /当前画板|重新操作/)
})
