import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasStore, createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'
import { createMinimapScene } from '../renderer/minimap-scene.js'

test('H11：简图按可见父子关系裁剪，父框变化从记录差量刷新；卸载解除订阅', () => {
  const store = createCanvasStore()
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 100, y: 200, props: { w: 100, h: 100 } },
    { type: 'create_shape', id: 'shape:child', shapeType: 'geo', parentId: 'shape:frame', x: 80, y: 30, props: { w: 80, h: 20 } },
    { type: 'create_shape', id: 'shape:outside', shapeType: 'geo', parentId: 'shape:frame', x: 180, y: 30, props: { w: 80, h: 20 } },
    { type: 'create_shape', id: 'shape:hidden', shapeType: 'geo', opacity: 0, x: 0, y: 0, props: { w: 10, h: 10 } },
  ]).snapshot
  store.loadStoreSnapshot(snapshot)
  store.put([{ ...store.get('shape:hidden'), opacity: 0 }])
  let reads = 0, changes = 0
  const all = store.allRecords.bind(store); store.allRecords = () => { reads++; return all() }
  const scene = createMinimapScene(store, undefined, () => changes++)
  try {
    const boxes = scene.boxes(), child = boxes.find(b => b.id === 'shape:child')
    assert.deepEqual(child, { id: 'shape:child', x: 180, y: 230, w: 20, h: 20 })
    assert.equal(boxes.some(b => b.id === 'shape:outside' || b.id === 'shape:hidden'), false)
    for (let i = 0; i < 100; i++) assert.equal(scene.boxes(), boxes)
    assert.equal(reads, 1, '相机帧不可重复枚举 Store')
    const frame = store.get('shape:frame'); store.put([{ ...frame, x: 150 }])
    assert.equal(scene.boxes().find(b => b.id === child.id).x, 230)
    assert.ok(changes > 0)
    store.put([{ ...store.get('shape:frame'), opacity: 0 }])
    assert.equal(scene.boxes().length, 0)
    const count = changes; scene.dispose(); store.put([{ ...frame, x: 350 }]); assert.equal(changes, count)
  } finally { scene.dispose(); store.dispose() }
})
