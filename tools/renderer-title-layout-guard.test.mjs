import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkTitleLayoutTrace } from './renderer-preview/title-layout-guard.mjs'

const invalidation = nodeId => ({ name: 'LayoutInvalidationTracking', args: { data: { nodeId } } })
const layout = (nodeId, nodeName = 'DIV') => ({ name: 'Layout', args: { endData: { layoutRoots: [{ nodeId, nodeName }] } } })

test('只有标题失效仍不足以通过：文档根发生布局时必须拦下', () => {
  assert.throws(() => checkTitleLayoutTrace([invalidation(50), layout(1, '#document')], [50]), /布局传播到标题以外/)
  assert.equal(checkTitleLayoutTrace([invalidation(50), layout(50)], [50]).titleLayoutRoots, 1)
})

test('没有失效证据、ID缺失或实际布局根不明时拒绝宣称隔离成功', () => {
  for (const trace of [[], [layout(50)], [invalidation(), layout(50)], [invalidation(50), { name: 'Layout' }]]) {
    assert.throws(() => checkTitleLayoutTrace(trace, [50]))
  }
  assert.throws(() => checkTitleLayoutTrace([invalidation(51), layout(50)], [50]), /标题以外/)
})
