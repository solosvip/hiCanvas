import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSession, createCanvasInteraction, createClipboardContent, encodeClipboardContent } from '../engine/index.js'
import { createPreviewClipboard } from '../tools/renderer-preview/clipboard.js'
import { memoryHost, shape, snapshotOf } from './fixtures/editor-session-fixture.mjs'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function setup(t, host = memoryHost()) {
  const session = await createEditorSession({ transport: host.transport, actor: 'ui:discrete' })
  t.after(() => session.dispose())
  return { session, host }
}

test('离散命令保留语义并采用服务端回执，没有本地预览或put替换', async t => {
  const host = memoryHost()
  host.canonicalize(r => { if (r.id === 'shape:one') r.meta.canonical = true })
  const commit = host.transport.commit
  host.transport.commit = async request => { const { snapshot, ...reply } = await commit(request); return reply }
  const { session } = await setup(t, host)
  const pending = session.commitCommands([shape('one')], { expectedRevision: 'v0' })
  assert.equal(session.store.has('shape:one'), false)
  assert.equal(session.state.get().isSubmitting, true)
  const reply = await pending
  assert.equal(host.commits[0].commands[0].type, 'create_shape')
  assert.equal(session.store.get('shape:one').meta.canonical, true)
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
  assert.equal(session.state.get().revision, reply.revision)
  assert.equal(session.state.get().isSubmitting, false)
})

test('手势中或提交中拒绝新离散命令，IO开始前同步占忙碌门', async t => {
  const { session, host } = await setup(t)
  session.beginGesture()
  assert.throws(() => session.commitCommands([shape('blocked')]), e => e.code === 'busy')
  session.cancelGesture()
  const gate = deferred()
  host.beforeCommit(() => gate.promise)
  const pending = session.commitCommands([shape('one')])
  assert.throws(() => session.commitCommands([shape('two')]), e => e.code === 'busy')
  assert.throws(() => session.beginGesture(), e => e.code === 'busy')
  gate.resolve()
  await pending
  assert.equal(host.commits.length, 1)
})

test('调用时旧版本拒绝且零提交；排队期间收到更新也不提交旧命令', async t => {
  const { session, host } = await setup(t)
  await host.remote([shape('remote')])
  await session.refresh()
  assert.throws(() => session.commitCommands([shape('stale')], { expectedRevision: 'v0' }), e => e.code === 'conflict')
  assert.equal(host.commits.length, 1)
  const refresh = session.refresh()
  const pending = session.commitCommands([shape('queued')])
  await host.remote([shape('another')])
  await refresh
  await assert.rejects(pending, e => e.code === 'conflict')
  assert.equal(session.store.has('shape:queued'), false)
  assert.equal(host.commits.length, 2)
})

test('服务端版本冲突时刷新报告，不自动重放或不带版本重试', async t => {
  const { session, host } = await setup(t)
  await host.remote([shape('remote')], { broadcast: false })
  const requests = []
  const commit = host.transport.commit
  host.transport.commit = request => { requests.push(request); return commit(request) }
  await assert.rejects(session.commitCommands([shape('local')]), e => e.code === 'conflict')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].expectedRevision, 'v0')
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
  assert.equal(session.state.get().lastError.code, 'conflict')
  assert.equal(session.store.has('shape:local'), false)
})

test('提交途中释放会话，迟到回执拒绝且不写已释放Store', async t => {
  const { session, host } = await setup(t)
  const gate = deferred(), entered = deferred()
  host.beforeCommit(() => { entered.resolve(); return gate.promise })
  const pending = session.commitCommands([shape('late')])
  await entered.promise
  session.dispose()
  gate.resolve()
  await assert.rejects(pending, e => e.code === 'disposed')
  assert.equal(host.commits.length, 1)
  assert.equal(host.listenerCount(), 0)
})

test('保存后网络回执丢失只重新读取，不多插入一次；读也失败时保留确认副本', async t => {
  for (const saved of [false, true]) {
    const host = memoryHost(), commit = host.transport.commit
    const { session } = await setup(t, host)
    const before = snapshotOf(session)
    let calls = 0
    host.transport.commit = async request => {
      calls++
      if (saved) await commit(request)
      else host.transport.read = async () => { throw new Error('read offline') }
      throw new Error('reply offline')
    }
    await assert.rejects(session.commitCommands([shape('one')]), /reply offline/)
    assert.equal(calls, 1)
    assert.deepEqual(snapshotOf(session), saved ? host.current().snapshot : before)
    assert.equal(session.state.get().isSubmitting, false)
    assert.match(session.state.get().lastError.message, /reply offline/)
  }
})

async function editor(t, port = {}, options = {}) {
  const host = memoryHost()
  await host.remote([shape('one', { x: 100, y: 160, props: { w: 100, h: 80 } }), shape('two', { x: 340, y: 260, props: { w: 80, h: 120 } })])
  const { session } = await setup(t, host)
  let value = {}, reads = 0, writes = 0
  const clipboard = { async read() { reads++; return structuredClone(value) }, async write(next) { writes++; value = structuredClone(next) }, ...port }
  const interaction = createCanvasInteraction({ session, camera: { x: 0, y: 0, z: 1 }, viewport: { w: 1000, h: 700 }, clipboard, boardId: 'synthetic', ...options })
  t.after(() => interaction.dispose())
  interaction.select('all')
  return { interaction, session, host, counts: () => ({ reads, writes }), formats: () => value }
}

test('公开动作及C/X/V共用注入端口，复制不提交、粘贴选中新根且原位重叠', async t => {
  const { interaction: ui, host, counts, session } = await editor(t)
  const commits = host.commits.length
  assert.equal((await ui.runAction('copy')).status, 'copied')
  assert.equal(host.commits.length, commits)
  assert.deepEqual(counts(), { reads: 0, writes: 1 })
  await ui.dispatch({ type: 'key_down', key: 'v', ctrlKey: true, time: 1 })
  assert.deepEqual(counts(), { reads: 1, writes: 1 })
  assert.equal(host.commits.length, commits + 1)
  assert.equal(host.commits.at(-1).commands[0].type, 'paste_content')
  assert.deepEqual(ui.state.get().selectedIds.map(id => { const r = session.store.get(id); return [r.x, r.y] }), [[100, 160], [340, 260]])
  assert.equal(ui.state.get().selectedIds.some(id => ['shape:one', 'shape:two'].includes(id)), false)
})

test('表单、菜单、编辑文字、组字、指针手势和提交中均不读写剪贴板', async t => {
  const { interaction: ui, session, counts } = await editor(t)
  for (const context of [{ owner: 'form' }, { owner: 'menu' }, { owner: 'text-editing' }, { owner: 'canvas', isComposing: true }]) {
    ui.setInputContext(context)
    for (const action of ['copy', 'cut', 'paste']) assert.equal((await ui.runAction(action)).status, 'unavailable')
  }
  ui.setInputContext({ owner: 'canvas' })
  session.beginGesture()
  for (const action of ['copy', 'cut', 'paste']) assert.equal((await ui.runAction(action)).status, 'unavailable')
  session.cancelGesture()
  const pending = session.commitCommands([shape('saving')])
  for (const action of ['copy', 'cut', 'paste']) assert.equal((await ui.runAction(action)).status, 'unavailable')
  await pending
  assert.deepEqual(counts(), { reads: 0, writes: 0 })
})

test('剪切先等写入确认，写失败不删；成功只提交一次删除', async t => {
  const gate = deferred()
  let fail = true
  const { interaction: ui, session, host } = await editor(t, { async write() { if (fail) throw new Error('clipboard denied'); await gate.promise } })
  const before = host.commits.length
  await assert.rejects(ui.runAction('cut'), /clipboard denied/)
  assert.ok(session.store.has('shape:one'))
  assert.equal(host.commits.length, before)
  fail = false
  const pending = ui.runAction('cut')
  await Promise.resolve()
  assert.ok(session.store.has('shape:one'))
  gate.resolve()
  await pending
  assert.equal(host.commits.length, before + 1)
  assert.deepEqual(host.commits.at(-1).commands, [{ type: 'delete', ids: ['shape:one', 'shape:two'] }])
  assert.equal(session.store.has('shape:one'), false)
})

test('异步IO后复查版本、焦点和会话，失败不粘贴或剪切，重复动作不重复IO', { timeout: 3000 }, async t => {
  for (const mode of ['revision', 'focus', 'dispose']) {
    const gate = deferred(), entered = deferred()
    let reads = 0
    const { interaction: ui, host, session } = await editor(t, { async read() { reads++; entered.resolve(); return gate.promise } })
    const content = createClipboardContent(snapshotOf(session), ['shape:one'])
    const pending = ui.runAction('paste')
    await entered.promise
    assert.equal((await ui.runAction('paste')).status, 'unavailable')
    if (mode === 'revision') { await host.remote([shape('remote')]); await session.refresh() }
    if (mode === 'focus') { ui.setInputContext({ owner: 'form' }); ui.setInputContext({ owner: 'canvas' }) }
    if (mode === 'dispose') ui.dispose()
    gate.resolve(encodeClipboardContent(content))
    await assert.rejects(pending)
    assert.equal(reads, 1)
    assert.equal(host.commits.filter(c => c.actor === 'ui:discrete').length, 0)
  }
})

test('读取失败和外部纯文本不改画板；光标偏好是会话状态且Shift不改变落点', async t => {
  const { interaction: ui, session, host } = await editor(t)
  await ui.runAction('copy')
  const before = host.commits.length
  assert.equal(ui.state.get().pasteAtCursor, false)
  await ui.runAction('paste-at-cursor')
  assert.equal(ui.state.get().pasteAtCursor, true)
  assert.equal(host.commits.length, before)
  ui.dispatch({ type: 'pointer_move', point: { x: 800, y: 550 }, pointerId: 1, time: 1 })
  await ui.dispatch({ type: 'key_down', key: 'v', ctrlKey: true, shiftKey: true, time: 2 })
  assert.deepEqual(ui.state.get().selectedIds.map(id => { const r = session.store.get(id); return [r.x, r.y] }), [[640, 440], [880, 540]])
  const other = await editor(t, { async read() { return { 'text/plain': 'external text' } } })
  assert.equal((await other.interaction.runAction('paste')).status, 'unavailable')
  const failed = await editor(t, { async read() { throw new Error('read denied') } })
  await assert.rejects(failed.interaction.runAction('paste'), /read denied/)
  assert.equal(failed.host.commits.filter(c => c.actor === 'ui:discrete').length, 0)
})

test('宿主内存端口与合成ClipboardEvent走同一动作，组字和表单事件既不截获也不读取', async t => {
  const doc = new EventTarget()
  doc.defaultView = { navigator: Object.defineProperty({}, 'clipboard', { get() { throw new Error('must not read system clipboard') } }) }
  const adapter = createPreviewClipboard({ host: { ownerDocument: doc }, transport: {}, sandbox: true })
  const { interaction: ui } = await editor(t, adapter.port)
  const stop = adapter.attach(ui); t.after(stop)
  const event = type => {
    const e = new Event(type, { cancelable: true })
    e.clipboardData = { types: [], getData() { throw new Error('blocked event must not read') }, setData(type) { this.types.push(type) } }
    doc.dispatchEvent(e)
    return e
  }
  for (const context of [{ owner: 'form' }, { owner: 'canvas', isComposing: true }]) {
    ui.setInputContext(context)
    assert.equal(event('paste').defaultPrevented, false)
    assert.equal(event('copy').defaultPrevented, false)
  }
  assert.deepEqual(adapter.inspect(), { reads: 0, writes: 0, formats: {} })
  ui.setInputContext({ owner: 'canvas' })
  const copied = event('copy')
  assert.equal(copied.defaultPrevented, true)
  // The port completes asynchronously, with the same private DataTransfer.
  for (let i = 0; i < 10 && ui.state.get().clipboardBusy; i++) await Promise.resolve()
  assert.ok(copied.clipboardData.types.includes('text/html'))
  assert.equal(adapter.inspect().writes, 1)
})

test('剪切写入后基线变化，已写入内容保留但不提交删除', async t => {
  const gate = deferred(), entered = deferred()
  const { interaction: ui, host, session } = await editor(t, { async write() { entered.resolve(); await gate.promise } })
  const pending = ui.runAction('cut')
  await entered.promise
  await host.remote([shape('remote')]); await session.refresh()
  gate.resolve()
  await assert.rejects(pending, e => e.code === 'conflict')
  assert.equal(session.store.has('shape:one'), true)
  assert.equal(host.commits.filter(c => c.actor === 'ui:discrete').length, 0)
})

test('空选择等待读取时Esc明确取消，读取完成也不粘贴', async t => {
  const gate = deferred(), entered = deferred()
  const { interaction: ui, session, host } = await editor(t, { async read() { entered.resolve(); return gate.promise } })
  const formats = encodeClipboardContent(createClipboardContent(snapshotOf(session), ['shape:one']))
  ui.select('clear')
  const pending = ui.runAction('paste')
  await entered.promise
  assert.ok(ui.getActions().filter(action => ['copy', 'cut', 'paste', 'paste-at-cursor'].includes(action.id)).every(action => !action.available))
  ui.dispatch({ type: 'key_down', key: 'Escape', time: 1 })
  gate.resolve(formats)
  await assert.rejects(pending, e => e.code === 'conflict')
  assert.equal(host.commits.filter(c => c.actor === 'ui:discrete').length, 0)
})

test('未注入剪贴板端口时动作明确不可用，偏好开关仍有独立会话状态', async t => {
  const { session } = await setup(t)
  const ui = createCanvasInteraction({ session, camera: { x: 0, y: 0, z: 1 }, viewport: { w: 1000, h: 700 } })
  t.after(() => ui.dispose())
  assert.equal(ui.getActions().find(action => action.id === 'paste').available, false)
  assert.equal(ui.getActions().find(action => action.id === 'paste-at-cursor').available, true)
})
