import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, CanvasEditError } from '../engine/index.js'

const image = { src: '/assets/synthetic.png', name: 'synthetic.png', w: 800, h: 400, mimeType: 'image/png' }
const html = { url: 'data:text/html,<h1>合成</h1>', assetUrl: '/assets/synthetic.html', contentHash: 'synthetic-hash' }
function shapes(commands) { return executeCanvasCommands(createCanvasSnapshot(), commands).snapshot }

test('放图命令在同一事务写入资源与形状，按目标框匹配尺寸并旁置', () => {
  const initial = shapes([{ type: 'create_shape', id: 'shape:target', shapeType: 'frame', x: 100, y: 200, props: { w: 600, h: 300 } }])
  const before = structuredClone(initial)
  const result = executeCanvasCommands(initial, [{ type: 'insert_image', args: { anchorShapeId: 'shape:target' }, image }])
  const receipt = result.results[0]
  assert.deepEqual(receipt.bounds, { x: 740, y: 200, w: 600, h: 300 })
  assert.equal(receipt.pageId, 'page:page')
  assert.equal(receipt.shapeRecord.type, 'image')
  assert.deepEqual(result.snapshot.store[receipt.shapeId], receipt.shapeRecord)
  const asset = result.snapshot.store[receipt.shapeRecord.props.assetId]
  assert.deepEqual(asset.props, { name: image.name, src: image.src, w: 800, h: 400, mimeType: 'image/png', isAnimated: false })
  assert.deepEqual(Object.keys(result.changes.added).sort(), [asset.id, receipt.shapeId].sort())
  assert.deepEqual(initial, before)
  assert.deepEqual(executeCanvasCommands(initial, [{ type: 'update', id: 'shape:target', changes: { x: 200 } }]).results, [null])
})

test('网页更新保留原 ID、位置、旋转、层级并合并元数据，影片继承目标配置', () => {
  const initial = shapes([{ type: 'create_shape', id: 'shape:film', shapeType: 'frame', x: 40, y: 80, rotation: 0.3, props: { w: 900, h: 500 }, meta: { cowartAiDraftHolder: true, cowartAiFilmHolder: true, cowartFilmDuration: 8, cowartFilmStyle: 'synthetic', cowartFilmMuted: true } }])
  const created = executeCanvasCommands(initial, [{ type: 'insert_html', args: { draftShapeId: 'shape:film', shapeMeta: { keep: true } }, html }])
  const first = created.results[0]
  assert.equal(first.replacedAiDraftHolder, true)
  assert.deepEqual(first.bounds, { x: 40, y: 80, w: 900, h: 500 })
  assert.equal(first.shapeRecord.meta.cowartFilmDuration, 8)
  assert.equal(first.shapeRecord.meta.cowartFilmStyle, 'synthetic')
  assert.equal(first.shapeRecord.meta.cowartFilmMuted, true)
  const updated = executeCanvasCommands(created.snapshot, [{ type: 'insert_html', args: { draftShapeId: first.shapeId, shapeMeta: { next: '第二稿' } }, html: { ...html, contentHash: 'second-hash' } }])
  const second = updated.results[0]
  assert.equal(second.shapeId, first.shapeId)
  assert.equal(second.updatedExistingHtmlDraft, true)
  assert.equal(second.shapeRecord.index, first.shapeRecord.index)
  assert.equal(second.shapeRecord.rotation, first.shapeRecord.rotation)
  assert.equal(second.shapeRecord.parentId, first.shapeRecord.parentId)
  assert.deepEqual(second.bounds, first.bounds)
  assert.equal(second.shapeRecord.meta.keep, true)
  assert.equal(second.shapeRecord.meta.next, '第二稿')
  assert.equal(second.shapeRecord.meta.cowartHtmlDraftContentHash, 'second-hash')
  assert.deepEqual(updated.changes.updated[first.shapeId], [first.shapeRecord, second.shapeRecord])
})

function canvasPose(records, id) {
  const shape = records[id]
  if (records[shape.parentId].typeName === 'page') return { x: shape.x, y: shape.y, rotation: shape.rotation }
  const parent = canvasPose(records, shape.parentId)
  return { x: parent.x + Math.cos(parent.rotation) * shape.x - Math.sin(parent.rotation) * shape.y, y: parent.y + Math.sin(parent.rotation) * shape.x + Math.cos(parent.rotation) * shape.y, rotation: parent.rotation + shape.rotation }
}

test('替换图片占位框保住嵌套标注的画布位置、旋转与前后层次', () => {
  const initial = shapes([
    { type: 'create_shape', id: 'shape:parent', shapeType: 'group', x: 50, y: 70, rotation: 0.2 },
    { type: 'create_shape', id: 'shape:holder', shapeType: 'frame', parentId: 'shape:parent', x: 100, y: 200, rotation: 0.4, props: { w: 600, h: 300 }, meta: { cowartAiImageHolder: true } },
    { type: 'create_shape', id: 'shape:annotation', shapeType: 'group', parentId: 'shape:holder', x: 20, y: 30, rotation: 0.1 },
    { type: 'create_shape', id: 'shape:label', shapeType: 'text', parentId: 'shape:annotation', x: 10, y: 5, text: '标注' },
    { type: 'create_shape', id: 'shape:above', shapeType: 'geo', parentId: 'shape:parent' }
  ])
  const before = structuredClone(initial)
  const result = executeCanvasCommands(initial, [{ type: 'insert_image', args: { anchorShapeId: 'shape:holder' }, image }])
  const receipt = result.results[0], records = result.snapshot.store
  assert.equal(receipt.replacedAiImageHolder, true)
  assert.deepEqual(receipt.bounds, { x: 100, y: 200, w: 600, h: 300 })
  assert.equal(receipt.shapeRecord.parentId, 'shape:parent')
  assert.equal(receipt.shapeRecord.rotation, 0.4)
  assert.equal(receipt.shapeRecord.index, initial.store['shape:holder'].index)
  assert.equal(records['shape:holder'], undefined)
  assert.deepEqual(result.changes.removed['shape:holder'], initial.store['shape:holder'])
  assert.equal(records['shape:annotation'].parentId, 'shape:parent')
  for (const id of ['shape:annotation', 'shape:label']) {
    const oldPose = canvasPose(initial.store, id), newPose = canvasPose(records, id)
    for (const field of ['x', 'y', 'rotation']) assert.ok(Math.abs(oldPose[field] - newPose[field]) < 1e-9, `${id} 的 ${field} 不应变化`)
  }
  assert.ok(receipt.shapeRecord.index < records['shape:annotation'].index)
  assert.ok(records['shape:annotation'].index < records['shape:above'].index)
  assert.deepEqual(initial, before)
})

test('幻灯片按同一事务中的已有子页横排，并撑大外框', () => {
  const initial = shapes([{ type: 'create_shape', id: 'shape:slides', shapeType: 'frame', props: { w: 200, h: 100 }, meta: { cowartAiSlides: true, cowartAiSlidesPadding: 10, cowartAiSlidesGap: 20 } }])
  const args = { draftShapeId: 'shape:slides', displayWidth: 300, displayHeight: 150 }
  const result = executeCanvasCommands(initial, [{ type: 'insert_html', args, html }, { type: 'insert_html', args, html }])
  assert.deepEqual(result.results.map(receipt => receipt.bounds), [{ x: 10, y: 10, w: 300, h: 150 }, { x: 330, y: 10, w: 300, h: 150 }])
  assert.deepEqual([result.snapshot.store['shape:slides'].props.w, result.snapshot.store['shape:slides'].props.h], [1048, 600])
  for (const receipt of result.results) {
    assert.equal(receipt.shapeRecord.parentId, 'shape:slides')
    assert.equal(receipt.shapeRecord.meta.cowartAiSlidesParentShapeId, 'shape:slides')
  }
  assert.deepEqual(result.changes.updated['shape:slides'][0], initial.store['shape:slides'])
})

test('旁置避开同层对象，禁用替换时填入占位框，禁用网页更新时另建草稿', () => {
  const initial = shapes([
    { type: 'create_shape', id: 'shape:anchor', shapeType: 'geo', props: { w: 100, h: 100 } },
    { type: 'create_shape', id: 'shape:obstacle', shapeType: 'geo', x: 140, props: { w: 100, h: 100 } },
    { type: 'create_shape', id: 'shape:holder', shapeType: 'frame', x: 800, rotation: 0.3, meta: { cowartAiImageHolder: true } }
  ])
  for (const [placement, obstacle, expected] of [['right', { x: 140, y: 0 }, { x: 280, y: 0 }], ['left', { x: -140, y: 0 }, { x: -280, y: 0 }], ['below', { x: 0, y: 140 }, { x: 0, y: 280 }]]) {
    const snapshot = executeCanvasCommands(initial, [{ type: 'update', id: 'shape:obstacle', changes: obstacle }]).snapshot
    const result = executeCanvasCommands(snapshot, [{ type: 'insert_image', args: { anchorShapeId: 'shape:anchor', placement }, image }])
    assert.deepEqual(result.results[0].bounds, { ...expected, w: 100, h: 100 })
  }
  const filled = executeCanvasCommands(initial, [{ type: 'insert_image', args: { anchorShapeId: 'shape:holder', replaceAiImageHolder: false }, image }])
  assert.ok(filled.snapshot.store['shape:holder'])
  assert.equal(filled.results[0].replacedAiImageHolder, false)
  assert.equal(filled.results[0].shapeRecord.parentId, 'shape:holder')
  assert.deepEqual(filled.results[0].bounds, { x: 0, y: 0, w: 1024, h: 576 })
  const first = executeCanvasCommands(initial, [{ type: 'insert_html', html }])
  const second = executeCanvasCommands(first.snapshot, [{ type: 'insert_html', args: { draftShapeId: first.results[0].shapeId, updateExistingDraft: false }, html }])
  assert.notEqual(second.results[0].shapeId, first.results[0].shapeId)
  assert.equal(second.results[0].updatedExistingHtmlDraft, false)
  assert.deepEqual(second.snapshot.store[first.results[0].shapeId], first.results[0].shapeRecord)
})

test('放置失败或后续命令失败时整批丢弃，目标已删与参数错误分开报告', () => {
  const initial = createCanvasSnapshot(), before = structuredClone(initial)
  for (const commands of [
    [{ type: 'insert_image', image, args: { displayWidth: 0 } }],
    [{ type: 'insert_html', html }, { type: 'update', id: 'shape:missing', changes: { x: 1 } }]
  ]) assert.throws(() => executeCanvasCommands(initial, commands), error => error instanceof CanvasEditError && error.code === 'invalid-input')
  assert.throws(() => executeCanvasCommands(initial, [{ type: 'insert_image', image }, { type: 'insert_html', html, args: { draftShapeId: 'shape:deleted' } }]), error => error instanceof CanvasEditError && error.code === 'conflict' && error.message === '目标框已被删除；结果未插入其他位置。')
  assert.deepEqual(initial, before)
  const result = executeCanvasCommands(initial, [{ type: 'insert_html', html }])
  result.results[0].shapeRecord.meta.editable = true
  assert.equal(result.snapshot.store[result.results[0].shapeId].meta.editable, undefined)
  assert.equal(result.changes.added[result.results[0].shapeId].meta.editable, undefined)
})
