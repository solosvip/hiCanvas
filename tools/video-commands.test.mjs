import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'

const video = { src: '/c/synthetic/assets/grid.mp4', name: 'grid.mp4', mimeType: 'video/mp4', w: 1280, h: 720, fileSize: 100 }
test('F07 视频插入保留自然尺寸，F20 替换保留身份位置并重置进度，不修改旧资产', () => {
  const before = createCanvasSnapshot()
  const inserted = executeCanvasCommands(before, [{ type: 'insert_video', args: { x: 100, y: 120 }, video }])
  const { shapeId, assetId } = inserted.results[0], shape = inserted.snapshot.store[shapeId]
  assert.deepEqual([shape.x, shape.y, shape.props.w, shape.props.h], [100, 120, 1280, 720])
  assert.equal(shape.props.playing, true)
  const replaced = executeCanvasCommands(inserted.snapshot, [{ type: 'replace_video', id: shapeId, video: { ...video, w: 160, h: 320 } }])
  const next = replaced.snapshot.store[shapeId]
  assert.deepEqual([next.id, next.x, next.y, next.props.w, next.props.h, next.props.time], [shapeId, 100, 120, 160, 320, 0])
  assert.notEqual(next.props.assetId, assetId)
  assert.deepEqual(replaced.snapshot.store[assetId], inserted.snapshot.store[assetId])
  const labeled = executeCanvasCommands(replaced.snapshot, [{ type: 'set_video_alt_text', id: shapeId, altText: '彩色分区展示' }]).snapshot
  assert.equal(labeled.store[shapeId].props.altText, '彩色分区展示')
  assert.equal(labeled.store[shapeId].props.assetId, next.props.assetId)
  assert.deepEqual(Object.values(before.store).filter(r => r.typeName === 'asset'), [])
})
test('视频命令拒绝外链、路径穿越、无效尺寸和锁定容器；失败不修改原快照', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'insert_video', video }])
  const id = initial.results[0].shapeId, before = structuredClone(initial.snapshot)
  for (const src of ['https://example.com/a.mp4', '//example.com/a.mp4', '/assets/%2e%2e/a.mp4', '/assets/a%2fb.mp4', 'data:video/mp4;base64,AAAA']) {
    assert.throws(() => executeCanvasCommands(before, [{ type: 'replace_video', id, video: { ...video, src } }]), /本机资源/)
  }
  assert.throws(() => executeCanvasCommands(before, [{ type: 'replace_video', id, video: { ...video, w: 0 } }]), /尺寸/)
  const locked = executeCanvasCommands(before, [{ type: 'update', id, changes: { isLocked: true } }]).snapshot
  assert.throws(() => executeCanvasCommands(locked, [{ type: 'replace_video', id, video }]), /锁定/)
  assert.deepEqual(initial.snapshot, before)
})
