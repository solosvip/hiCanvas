import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSession, createCanvasInteraction, createExternalClipboardContent } from '../engine/index.js'
import { memoryHost, snapshotOf } from './fixtures/editor-session-fixture.mjs'
import { createPreviewClipboard } from '../tools/renderer-preview/clipboard.js'

async function editor(t, read) {
  const host = memoryHost()
  const session = await createEditorSession({ transport: host.transport, actor: 'ui:external' })
  const ui = createCanvasInteraction({ session, viewport: { w: 1000, h: 700 }, camera: { x: 0, y: 0, z: 1 }, clipboard: { read, async write() {} } })
  t.after(() => { ui.dispose(); session.dispose() })
  return { host, session, ui }
}
const content = () => createExternalClipboardContent({ type: 'text', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic paste' }] }] } })
const notice = { source: 'clipboard', message: '1 个元素类型暂不支持，已跳过', counts: { unsupportedTypes: 1 } }

test('净化内容沿同一paste事务一次提交，通知独立于错误且下一动作清除', async t => {
  let value = { kind: 'external-content', content: content(), placement: 'default', notice }
  const { host, session, ui } = await editor(t, async () => value)
  const result = await ui.runAction('paste')
  assert.equal(result.status, 'applied')
  assert.equal(host.commits.length, 1)
  assert.equal(host.commits[0].commands.length, 1)
  assert.equal(host.commits[0].commands[0].type, 'paste_content')
  assert.equal(ui.state.get().selectedIds.length, 1)
  assert.deepEqual(ui.state.get().lastNotice, notice)
  assert.equal(ui.state.get().lastError, null)
  assert.ok(Object.isFrozen(ui.state.get().lastNotice))
  assert.ok(Object.isFrozen(ui.state.get().lastNotice.counts))
  const pasted = snapshotOf(session)
  await ui.runAction('copy')
  assert.equal(ui.state.get().lastNotice, null)
  assert.deepEqual(snapshotOf(session), pasted)
  value = { kind: 'external-content', content: null, placement: 'viewport-page', notice: { ...notice, message: '没有可导入的内容；1 个元素类型暂不支持，已跳过' } }
  const before = host.current(), commits = host.commits.length
  assert.equal((await ui.runAction('paste')).status, 'empty')
  assert.deepEqual(host.current(), before)
  assert.equal(host.commits.length, commits)
  assert.match(ui.state.get().lastNotice.message, /没有可导入/)
  assert.throws(() => ui.cropImage({ type: 'start', id: 'shape:missing' }))
  assert.equal(ui.state.get().lastNotice, null)
  assert.ok(ui.state.get().lastError)
  value = { kind: 'external-content', content: { invalid: true }, placement: 'default', notice: null }
  await assert.rejects(ui.runAction('paste'))
  assert.equal(ui.state.get().lastNotice, null)
  assert.ok(ui.state.get().lastError)
  assert.equal(host.commits.length, commits)
})

test('外部内容读取期间Esc、选择、焦点、目标画布变化和释放均阻止迟到的粘贴', async t => {
  for (const mode of ['escape', 'selection', 'focus', 'revision', 'dispose']) {
    let resolve, entered
    const gate = new Promise(r => { resolve = r }), started = new Promise(r => { entered = r })
    const { host, session, ui } = await editor(t, () => { entered(); return gate })
    await host.remote([{ type: 'create_shape', id: 'shape:existing', shapeType: 'geo' }]); await session.refresh()
    ui.select('all')
    const pending = ui.runAction('paste'); await started
    assert.equal((await ui.runAction('paste')).status, 'unavailable')
    if (mode === 'escape') ui.dispatch({ type: 'key_down', key: 'Escape', time: 1 })
    if (mode === 'selection') ui.select('clear')
    if (mode === 'focus') { ui.setInputContext({ owner: 'form' }); ui.setInputContext({ owner: 'canvas' }) }
    if (mode === 'revision') { await host.remote([{ type: 'update', id: session.store.allRecords().find(r => r.typeName === 'page').id, changes: { name: 'Changed target' } }]); await session.refresh() }
    if (mode === 'dispose') ui.dispose()
    resolve({ kind: 'external-content', content: content(), placement: 'default', notice })
    await assert.rejects(pending, error => error.code === 'conflict')
    assert.equal(host.commits.filter(c => c.actor === 'ui:external').length, 0)
    assert.equal(ui.state.get().lastNotice, null)
  }
})

test('宿主事件普通文本使用既有监听和输入门禁，表单组字不读，接管后只提交一次', async t => {
  const doc = new EventTarget()
  doc.defaultView = { navigator: Object.defineProperty({}, 'clipboard', { get() { throw new Error('system clipboard forbidden') } }) }
  const adapter = createPreviewClipboard({ host: { ownerDocument: doc }, transport: {}, sandbox: true })
  const { session, host, ui } = await editor(t, adapter.port.read)
  const detach = adapter.attach(ui); t.after(detach)
  const event = () => {
    const input = new Event('paste', { cancelable: true })
    input.clipboardData = { types: ['text/plain'], getData: () => 'Synthetic\nsecond line' }
    doc.dispatchEvent(input); return input
  }
  for (const context of [{ owner: 'form' }, { owner: 'canvas', isComposing: true }]) {
    ui.setInputContext(context)
    assert.equal(event().defaultPrevented, false)
  }
  assert.equal(adapter.inspect().reads, 0)
  ui.setInputContext({ owner: 'canvas' })
  assert.equal(event().defaultPrevented, true)
  for (let i = 0; i < 100 && ui.state.get().clipboardBusy; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(host.commits.length, 1)
  assert.equal(adapter.inspect().reads, 1)
  assert.equal(session.store.get(ui.state.get().selectedIds[0]).props.richText.content.length, 2)
})

test('有限坐标形成溢出的联合边界时整批拒绝，记录和版本不变且零提交', async t => {
  const shape = { geo: 'rectangle', x: -1e308, y: 0, w: 10, h: 10, rotation: 0, size: 'm', color: 'black', fill: 'none', dash: 'solid', opacity: 1 }
  const content = createExternalClipboardContent({ type: 'excalidraw', shapes: [shape, { ...shape, x: 1e308 }] })
  const { host, ui } = await editor(t, async () => ({ kind: 'external-content', content, placement: 'viewport-page', notice: null }))
  const before = host.current()
  await assert.rejects(ui.runAction('paste'), /联合边界/)
  assert.equal(host.commits.length, 0)
  assert.deepEqual(host.current(), before)
})
