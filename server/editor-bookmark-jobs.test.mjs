import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createCanvasInteraction, createEditorSession, executeCanvasCommands } from '../engine/index.js'
import { memoryHost } from './fixtures/editor-session-fixture.mjs'

const url = 'https://site.example.invalid/old', info = { title: '新标题', description: '描述', url }
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function setup(t) {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    ...Array.from({ length: 5 }, (_, n) => ({ type: 'insert_url', id: `shape:b${n}`, url })),
    { type: 'create_shape', shapeType: 'geo', id: 'shape:unrelated' },
  ]).snapshot
  const host = memoryHost(snapshot), session = await createEditorSession({ transport: host.transport, actor: 'ui:bookmarks' }), calls = []
  const ui = createCanvasInteraction({ session, boardId: 'synthetic:one', viewport: { w: 1000, h: 700 }, bookmarkMetadata: { fetchMetadata(value, options) {
    const gate = deferred(); calls.push({ url: value, ...options, ...gate }); return gate.promise
  } } })
  t.after(() => { ui.dispose(); session.dispose() })
  return { host, session, ui, calls }
}
const own = host => host.commits.filter(row => row.actor === 'ui:bookmarks')

test('换选择、相机和无关远端revision不丢弃，写回使用当前版本且只提交一次', async t => {
  const { ui, session, host, calls } = await setup(t)
  const pending = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  ui.select('all'); ui.select('clear'); ui.setCamera({ x: 20, y: 30, z: 2 })
  await host.remote([{ type: 'update', id: 'shape:unrelated', changes: { x: 300 } }]); await session.refresh()
  calls[0].resolve(info)
  assert.equal((await pending).status, 'applied')
  assert.equal(calls[0].signal.aborted, false)
  assert.equal(own(host).length, 1); assert.equal(own(host)[0].expectedRevision, 'v1')
  assert.equal(own(host)[0].commands[0].type, 'set_bookmark_metadata')
})

for (const kind of ['target', 'asset', 'url', 'delete', 'lock', 'hide', 'restore']) test(`目标变化使迟到结果永久失效：${kind}`, async t => {
  const { ui, session, host, calls } = await setup(t), shape = session.store.get('shape:b0')
  const pending = ui.bookmark({ type: 'refresh', id: shape.id })
  const changes = kind === 'asset' ? { type: 'update', id: shape.props.assetId, changes: { props: { title: '别人改过' } } }
    : kind === 'delete' ? { type: 'delete', ids: [shape.id] }
    : { type: 'update', id: shape.id, changes: kind === 'url' ? { props: { url: 'https://changed.example.invalid/' } } : kind === 'lock' ? { isLocked: true } : kind === 'hide' ? { opacity: 0 } : { x: 300 } }
  await host.remote([changes]); await session.refresh()
  if (kind === 'restore') { await host.remote([{ type: 'update', id: shape.id, changes: { x: shape.x } }]); await session.refresh() }
  assert.equal(calls[0].signal.aborted, true)
  calls[0].resolve(info); await pending; await tick()
  assert.equal(own(host).length, 0)
})

test('结果等无关手势结束后提交，不取消或截断用户手势', async t => {
  const { ui, session, host, calls } = await setup(t)
  const pending = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  session.beginGesture(); session.preview([{ type: 'update', id: 'shape:unrelated', changes: { x: 120 } }])
  calls[0].resolve(info); await tick()
  assert.equal(own(host).length, 0); assert.equal(session.state.get().isGestureActive, true)
  await session.commitGesture()
  assert.equal((await pending).status, 'applied')
  assert.equal(session.store.get('shape:unrelated').x, 120)
  assert.equal(own(host).length, 2)
})

test('提交409只发一次，读取新事实后不换revision重发旧结果', async t => {
  const { ui, session, host, calls } = await setup(t), requests = []
  const commit = host.transport.commit
  host.transport.commit = request => { requests.push(request); return commit(request) }
  const pending = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  await host.remote([{ type: 'update', id: 'shape:unrelated', changes: { x: 500 } }], { broadcast: false })
  calls[0].resolve(info)
  assert.equal((await pending).status, 'failed')
  assert.equal(requests.length, 1); assert.equal(session.state.get().revision, 'v1')
  assert.equal(own(host).length, 0)
})

test('显式取消、替代任务和dispose均丢弃晚到成功/失败，不覆盖新提示', async t => {
  const { ui, host, calls } = await setup(t)
  const first = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  ui.bookmark({ type: 'cancel', id: 'shape:b0' }); assert.equal(calls[0].signal.aborted, true)
  const second = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  calls[1].resolve(info); await second
  const notice = ui.state.get().lastNotice
  calls[0].reject(new Error('OLD failure')); await first; await tick()
  assert.deepEqual(ui.state.get().lastNotice, notice); assert.equal(own(host).length, 1)
  const third = ui.bookmark({ type: 'refresh', id: 'shape:b1' })
  ui.dispose(); calls[2].resolve(info); await third; await tick()
  assert.equal(calls[2].signal.aborted, true); assert.equal(own(host).length, 1)
})

test('最多4个任务，满时零新增请求；取消后可手动重试，不自动排队', async t => {
  const { ui, calls } = await setup(t)
  const pending = Array.from({ length: 4 }, (_, n) => ui.bookmark({ type: 'refresh', id: `shape:b${n}` }))
  assert.equal((await ui.bookmark({ type: 'refresh', id: 'shape:b4' })).status, 'unavailable')
  assert.equal(calls.length, 4)
  ui.bookmark({ type: 'cancel', id: 'shape:b0' }); await tick(); assert.equal(calls.length, 4)
  const last = ui.bookmark({ type: 'refresh', id: 'shape:b4' }); assert.equal(calls.length, 5)
  ui.dispose(); await Promise.all([...pending, last])
})

test('同一目标新刷新废弃旧代次，迟到成功不能覆盖新结果', async t => {
  const { ui, session, calls, host } = await setup(t)
  const old = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  const latest = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  assert.equal(calls[0].signal.aborted, true)
  calls[1].resolve({ ...info, title: '最新标题' }); await latest
  calls[0].resolve({ ...info, title: '过期标题' }); await old; await tick()
  assert.equal(session.store.get(session.store.get('shape:b0').props.assetId).props.title, '最新标题')
  assert.equal(own(host).length, 1)
})

test('祖先改动后恢复也永久失效，别的画板会话不接纳已销毁任务', async t => {
  const { ui, session, calls, host } = await setup(t)
  await host.remote([{ type: 'group_shapes', ids: ['shape:b0', 'shape:unrelated'], groupId: 'shape:parent' }]); await session.refresh()
  const group = session.store.get('shape:parent')
  const pending = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  await host.remote([{ type: 'update', id: group.id, changes: { isLocked: true } }]); await session.refresh()
  await host.remote([{ type: 'update', id: group.id, changes: { isLocked: false } }]); await session.refresh()
  calls[0].resolve(info); await pending; assert.equal(calls[0].signal.aborted, true); assert.equal(own(host).length, 0)
  const gone = ui.bookmark({ type: 'refresh', id: 'shape:b1' })
  ui.dispose()
  const next = createCanvasInteraction({ session, boardId: 'synthetic:two', viewport: { w: 1000, h: 700 } })
  t.after(() => next.dispose())
  calls[1].resolve(info); await gone; await tick()
  assert.equal(own(host).length, 0); assert.deepEqual(next.state.get().bookmarkJobs, [])
})

test('空结果和重复结果零提交；多个就绪结果依次使用最新确认版本', async t => {
  const { ui, calls, host } = await setup(t)
  const empty = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  calls[0].resolve({ title: '', description: '', url }); assert.equal((await empty).status, 'unchanged')
  assert.equal(own(host).length, 0)
  const a = ui.bookmark({ type: 'refresh', id: 'shape:b0' }), b = ui.bookmark({ type: 'refresh', id: 'shape:b1' })
  calls[1].resolve(info); calls[2].resolve(info)
  await Promise.all([a, b]); assert.deepEqual(own(host).map(row => row.expectedRevision), ['v0', 'v1'])
  const duplicate = ui.bookmark({ type: 'refresh', id: 'shape:b0' })
  calls[3].resolve(info); assert.equal((await duplicate).status, 'unchanged')
  assert.equal(own(host).length, 2)
})
