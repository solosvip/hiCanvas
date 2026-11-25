import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from '../server/test-helpers.mjs'
import { initializeConversation, currentConversationId } from '../src/conversations/client.js'

function browser(t, base, search = '') {
  const names = ['window', 'document', 'history', 'localStorage', 'fetch']
  const originals = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const saved = new Map([['hicanvas:last-conversation', 'legacy']])
  const fetch = globalThis.fetch
  globalThis.window = { location: { search } }
  globalThis.document = { title: '' }
  globalThis.history = { replaceState() {} }
  globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  globalThis.fetch = (path, options) => fetch(new URL(path, base), options)
  t.after(() => { for (const name of names) { if (originals[name]) Object.defineProperty(globalThis, name, originals[name]); else delete globalThis[name] } })
  return saved
}

test('所有画板已删除时启动为空状态，重开不重新创建默认画板', async t => {
  const { workspace, base } = await fixture(t)
  await workspace.remove('legacy', (await workspace.read('legacy')).revision)
  const saved = browser(t, base)
  assert.equal(await initializeConversation(), null)
  assert.equal(currentConversationId(), null)
  assert.equal(saved.has('hicanvas:last-conversation'), false)
  assert.deepEqual(await workspace.list(), [])
})

test('上次画板已删除时恢复现存画板；显式已删除链接返回删除状态，不偷偷替换', async t => {
  const { workspace, base } = await fixture(t)
  const remaining = await workspace.open({ title: '继续的画板' })
  await workspace.read(remaining.id)
  await workspace.remove('legacy', (await workspace.read('legacy')).revision)
  browser(t, base)
  assert.equal((await initializeConversation()).id, remaining.id)
  window.location.search = '?conversation=legacy'
  await assert.rejects(initializeConversation(), e => e.status === 410)
  assert.deepEqual((await workspace.list()).map(c => c.id), [remaining.id])
})
