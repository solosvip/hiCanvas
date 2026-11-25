import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { watchCanvasLifecycle, canvasRequestError } from '../src/conversations/canvasLifecycle.js'
import { setTimeout as delay } from 'node:timers/promises'

test('SSE 在首次连接及断线恢复时核验已删除画板，普通离线不误判，卸载后停止处理', async () => {
  const source = new EventTarget()
  let status = 503, deleted = 0, changes = 0, closed = 0
  source.close = () => closed++
  const watcher = watchCanvasLifecycle(() => changes++, { source, check: async () => { throw Object.assign(new Error('模拟状态'), { status }) }, deleted: () => deleted++ })
  await source.onerror()
  assert.equal(deleted, 0)
  source.dispatchEvent(new Event('canvas-changed'))
  assert.equal(changes, 1)
  status = 410
  source.dispatchEvent(new Event('open'))
  await delay(0)
  assert.equal(deleted, 1)
  await source.onerror()
  assert.equal(deleted, 2)
  watcher.close()
  assert.equal(closed, 1)
  assert.equal(source.onerror, null)
  source.dispatchEvent(new Event('canvas-deleted'))
  assert.equal(deleted, 2)
})

test('初始读取或保存返回410时通知画板退出编辑；其他错误不触发删除', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = new EventTarget()
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window })
  let deleted = 0
  window.addEventListener('hicanvas:board-deleted', () => deleted++)
  const ordinary = canvasRequestError({ error: '断网' }, 503)
  assert.equal(ordinary.status, 503)
  assert.equal(deleted, 0)
  const gone = canvasRequestError({ error: '画板已删除', storage: 'conversation-deleted' }, 410)
  assert.equal(gone.storage, 'conversation-deleted')
  assert.equal(deleted, 1)
})

test('旧核验未返回时收到重连错误，旧成功结果之后仍补查删除状态', async () => {
  const source = new EventTarget()
  let finishFirst, checks = 0, deleted = 0
  source.close = () => {}
  const first = new Promise(resolve => { finishFirst = resolve })
  const watcher = watchCanvasLifecycle(() => {}, { source, check: async () => {
    checks++
    if (checks === 1) return first
    throw Object.assign(new Error('画板已删除'), { status: 410 })
  }, deleted: () => deleted++ })
  source.dispatchEvent(new Event('open'))
  source.onerror()
  finishFirst({ revision: 0 })
  await delay(0)
  assert.equal(checks, 2)
  assert.equal(deleted, 1)
  watcher.close()
})
