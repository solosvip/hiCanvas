import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as turn } from 'node:timers/promises'
import { attachVideoUi } from './renderer-preview/video-ui.js'

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.dataset = {}; this.children = []; this.value = ''; this.disabled = false }
  setAttribute() {}
  append(...children) { this.children.push(...children) }
  remove() { this.removed = true }
}
for (const failure of [false, true]) test(`替代文字保存期间卸载，${failure ? '拒绝' : '完成'}回调不碰已关闭会话或视图`, async () => {
  const body = new Element('body'), nodes = [], doc = { body, createElement: tag => { const node = new Element(tag); nodes.push(node); return node } }
  const host = new Element('host'); host.ownerDocument = doc
  let focused = 0, canceled = 0, errors = 0, closed = false, finish, fail
  host.focus = () => { focused++ }
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  const shape = { id: 'shape:video', type: 'video', isLocked: false, props: { altText: '' } }
  const session = { store: { get: () => shape }, state: { get: () => { if (closed) throw new Error('会话已关闭'); return { revision: '0', isSubmitting: false, isGestureActive: false } } }, beginGesture() {}, preview() {}, commitGesture: () => pending, cancelGesture: () => { canceled++; if (closed) throw new Error('会话已关闭') } }
  const state = { selectedIds: [shape.id], camera: { x: 0, y: 0, z: 1 } }, interaction = { state: { get: () => state } }
  const ui = attachVideoUi(host, interaction, session, { viewState: { currentPageId: 'page:page' } }, () => { errors++ })
  ui.update(state)
  nodes.find(n => n.dataset.videoAction === 'save-alt-text').dispatchEvent(new Event('click'))
  ui.dispose(); closed = true
  if (failure) fail(new Error('模拟保存失败')); else finish()
  await turn(); await turn()
  assert.equal(canceled, 0); assert.equal(errors, 0); assert.equal(focused, 0)
  assert.equal(nodes.find(n => n.dataset.videoToolbar !== undefined).removed, true)
})
