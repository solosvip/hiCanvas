import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, CanvasEditError } from '../engine/index.js'

test('整批预留命令一次生成混合比例网格，并回执每项实际占位 ID', () => {
  const initial = createCanvasSnapshot(), before = structuredClone(initial)
  const result = executeCanvasCommands(initial, [{ type: 'reserve_image_batch', jobId: 'job-grid', args: { columns: 2, displayWidth: 100, displayHeight: 80, gap: 10, x: 10, y: 20 }, items: [
    { id: 'wide', holderId: 'shape:wide', aspectRatio: '2:1' },
    { id: 'tall', holderId: 'shape:tall', aspectRatio: '1:2' },
    { id: 'square', holderId: 'shape:square' }
  ] }])
  assert.deepEqual(result.results, [{ holderIds: ['shape:wide', 'shape:tall', 'shape:square'] }])
  assert.deepEqual(['wide', 'tall', 'square'].map(name => {
    const shape = result.snapshot.store[`shape:${name}`]
    return { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h }
  }), [{ x: 10, y: 20, w: 100, h: 50 }, { x: 120, y: 20, w: 100, h: 200 }, { x: 10, y: 230, w: 100, h: 80 }])
  assert.deepEqual(result.snapshot.store['shape:tall'].meta, { cowartAiImageHolder: true, hicanvasGeneration: { jobId: 'job-grid', itemId: 'tall', status: 'queued' } })
  assert.equal(Object.keys(result.changes.added).length, 3)
  assert.deepEqual(initial, before, '命令不改调用方快照')
})

test('复用已有目标只写生成标记，回执实际 ID，后续新框保留父级并贴目标排布', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:group', shapeType: 'group', x: 20, y: 30 },
    { type: 'create_shape', id: 'shape:holder', shapeType: 'frame', parentId: 'shape:group', x: 100, y: 200, rotation: .25, props: { w: 300, h: 150, name: '用户标题' }, meta: { cowartAiImageHolder: true, userNote: { content: '不要丢' }, hicanvasGeneration: { status: 'failed' } } }
  ]).snapshot
  const before = structuredClone(initial)
  const result = executeCanvasCommands(initial, [{ type: 'reserve_image_batch', jobId: 'job-reuse', args: { anchorShapeId: 'shape:holder' }, items: [
    { id: 'first', holderId: 'shape:unused' }, { id: 'second', holderId: 'shape:new' }
  ] }])
  assert.deepEqual(result.results, [{ holderIds: ['shape:holder', 'shape:new'] }])
  assert.equal(result.snapshot.store['shape:unused'], undefined)
  assert.deepEqual(result.snapshot.store['shape:holder'], { ...initial.store['shape:holder'], meta: { ...initial.store['shape:holder'].meta, hicanvasGeneration: { jobId: 'job-reuse', itemId: 'first', status: 'queued' } } })
  const next = result.snapshot.store['shape:new']
  assert.deepEqual({ parentId: next.parentId, x: next.x, y: next.y, w: next.props.w, h: next.props.h }, { parentId: 'shape:group', x: 440, y: 200, w: 300, h: 150 })
  assert.deepEqual(initial, before)
})

test('整批中途遇到非法框或正在生成的框时回滚，编辑层错误区分冲突与参数', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:ordinary', shapeType: 'frame' },
    { type: 'create_shape', id: 'shape:busy', shapeType: 'frame', meta: { cowartAiImageHolder: true, hicanvasGeneration: { status: 'queued' } } }
  ]).snapshot
  const before = structuredClone(initial)
  const items = [{ id: 'new', holderId: 'shape:new' }, { id: 'old', holderId: 'shape:ordinary' }]
  for (const [command, code, message] of [
    [{ type: 'reserve_image_batch', jobId: 'job', items }, 'invalid-input', '只能替换 AI 图片占位框；改图请在原图旁新建目标。'],
    [{ type: 'reserve_image_batch', jobId: 'job', items: [items[0], { ...items[1], holderId: 'shape:busy' }] }, 'conflict', '这个图片框正在生成，请等待当前任务完成。'],
    [{ type: 'reserve_image_batch', jobId: 'job', items, args: { anchorShapeId: 'shape:deleted' } }, 'conflict', '原目标框已删除。'],
    [{ type: 'reserve_image_batch', jobId: 'job', items, args: { columns: 0 } }, 'invalid-input', '每行数量需要 1 至 16。'],
    [{ type: 'reserve_image_batch', jobId: 'job', items, args: { gap: -1 } }, 'invalid-input', '图片框尺寸或间距无效。']
  ]) {
    assert.throws(() => executeCanvasCommands(initial, [command]), error => error instanceof CanvasEditError && error.code === code && error.message === message)
    assert.deepEqual(initial, before)
  }
})
