import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createExternalClipboardContent, executeCanvasCommands, planClipboardPaste, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

test('外部段落经公开构造器获得合法文本内容，保留粗斜体且不改正在使用的画板', () => {
  const board = createCanvasSnapshot(), before = structuredClone(board)
  const richText = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Hello ' }, { type: 'text', text: 'canvas', marks: [{ type: 'bold' }, { type: 'italic' }] },
  ] }, { type: 'paragraph', content: [{ type: 'text', text: '下一行' }] }] }
  const content = createExternalClipboardContent({ type: 'text', richText })
  assert.equal(content.shapes.length, 1)
  const [text] = content.shapes
  assert.equal(text.type, 'text')
  assert.deepEqual(text.props.richText, richText)
  assert.equal(text.props.autoSize, true)
  assert.equal(text.props.font, 'sans')
  const pasted = executeCanvasCommands(board, [{ type: 'paste_content', content }])
  assert.equal(pasted.results[0].rootIds.length, 1)
  assert.deepEqual(board, before)
})

test('编辑层重新校验宿主DTO，拒绝格式越权、方向未支持、原型字段和资源超限', () => {
  const text = value => ({ type: 'text', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } })
  const shape = { geo: 'rectangle', x: 0, y: 0, w: 10, h: 10, rotation: 0, size: 'm', color: 'black', fill: 'none', dash: 'solid', opacity: 1 }
  const bad = [
    { ...text('safe'), commands: [{ type: 'delete', ids: ['shape:real'] }] },
    text('مرحبا'), text('A'.repeat(100001)),
    { type: 'text', richText: { type: 'doc', content: [{ type: 'heading', content: [] }] } },
    { type: 'text', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.invalid' } }] }] }] } },
    JSON.parse('{"type":"text","__proto__":{},"richText":{}}'),
    { type: 'excalidraw', shapes: [{ ...shape, geo: 'star' }] },
    { type: 'excalidraw', shapes: [{ ...shape, x: Infinity }] },
    { type: 'excalidraw', shapes: Array.from({ length: 1001 }, () => shape) },
    { type: 'excalidraw', shapes: [{ ...shape, w: 0 }] },
  ]
  for (const value of bad) assert.throws(() => createExternalClipboardContent(value))
  const cyclic = text('safe'); cyclic.richText.content[0].content.push(cyclic)
  assert.throws(() => createExternalClipboardContent(cyclic), /外部|上限/)
  let accessed = false
  const getter = Object.defineProperty({}, 'type', { enumerable: true, get() { accessed = true; return 'text' } })
  assert.throws(() => createExternalClipboardContent(getter))
  assert.equal(accessed, false)
  assert.throws(() => createExternalClipboardContent({ type: 'excalidraw', shapes: Array(100001) }), /数组/)
  assert.throws(() => createExternalClipboardContent({ type: 'excalidraw', shapes: Array(3) }), /数组/)
  assert.equal(createExternalClipboardContent(text('   \n')), null)
  assert.equal(createExternalClipboardContent({ type: 'excalidraw', shapes: [] }), null)
})

test('外部几何整体居中到page，不受光标和画框影响，透明度与整次撤销重做保留', () => {
  const shape = { geo: 'rectangle', x: 10, y: 20, w: 10, h: 20, rotation: 0, size: 'm', color: 'black', fill: 'none', dash: 'solid', opacity: .5 }
  const content = createExternalClipboardContent({ type: 'excalidraw', shapes: [shape, { ...shape, geo: 'ellipse', x: 50, y: 100, w: 30, h: 40, opacity: 1 }] })
  const target = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 400, y: 250 }]).snapshot
  const plan = planClipboardPaste(target, content, { viewport: { x: 0, y: 0, w: 1000, h: 700 }, point: { x: 700, y: 420 }, atCursor: true, focusedGroupId: 'shape:frame', strategy: 'viewport-page' })
  assert.deepEqual(plan, { parentId: 'page:page', offset: { x: 455, y: 270 } })
  const result = executeCanvasCommands(target, [{ type: 'paste_content', content, ...plan }])
  const records = result.results[0].rootIds.map(id => result.snapshot.store[id])
  assert.deepEqual(records.map(r => [r.x, r.y, r.props.geo, r.opacity, r.parentId]), [[465, 290, 'rectangle', .5, 'page:page'], [505, 370, 'ellipse', 1, 'page:page']])
  const history = recordCanvasTransaction(undefined, 'external-paste', result.changes)
  const undo = undoCanvasTransaction(result.snapshot, history, 'external-paste')
  assert.deepEqual(undo.snapshot, target)
  assert.deepEqual(redoCanvasTransaction(undo.snapshot, undo.history, 'external-paste').snapshot, result.snapshot)
})
