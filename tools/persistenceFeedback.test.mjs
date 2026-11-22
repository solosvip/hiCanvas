import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPersistenceFeedback } from '../src/persistenceFeedback.js'

// 用最小 DOM 接口测试状态与事件，真实布局另经浏览器验证。
class Element extends EventTarget {
  children = []
  attributes = {}
  parent = null
  constructor(document) { super(); this.ownerDocument = document }
  setAttribute(name, value) { this.attributes[name] = value }
  get isConnected() { return this.parent !== null }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child) }) }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null }
}

test('保存失败持续提示；成功只清除对应失败；重试与关闭页面保护随状态变化', () => {
  const document = { defaultView: new EventTarget(), createElement() { return new Element(this) } }
  const container = new Element(document)
  let dirty = true
  let retries = 0
  const feedback = createPersistenceFeedback(container, () => { retries++ }, () => dirty)
  feedback.failed('canvas')
  feedback.failed('view')
  assert.equal(container.children.length, 1, '多次失败不能堆积通知')
  const [notice] = container.children
  assert.equal(notice.attributes.role, 'alert')
  assert.match(notice.children[0].textContent, /画板修改、视角尚未保存/)
  notice.children[1].dispatchEvent(new Event('click'))
  assert.equal(retries, 1)
  const before = new Event('beforeunload', { cancelable: true })
  document.defaultView.dispatchEvent(before)
  assert.equal(before.defaultPrevented, true, '未保存修改时不能静默关闭')
  feedback.saved('canvas')
  assert.equal(container.children.length, 1, '视角仍失败时不得显示全部成功')
  assert.match(notice.children[0].textContent, /^视角尚未保存/)
  feedback.saved('view')
  dirty = false
  assert.equal(container.children.length, 0)
  const after = new Event('beforeunload', { cancelable: true })
  document.defaultView.dispatchEvent(after)
  assert.equal(after.defaultPrevented, false)
  feedback.failed('canvas')
  feedback.dispose()
  feedback.failed('canvas')
  feedback.saved('view')
  assert.equal(container.children.length, 0)
  notice.children[1].dispatchEvent(new Event('click'))
  assert.equal(retries, 1, '卸载时必须清除事件处理器')
})
