import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'
import { createSpatialIndex } from '../renderer/geometry.js'

function fixture() {
  return executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 10, y: 10, props: { w: 100, h: 80, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 50, y: 20, props: { w: 100, h: 80, fill: 'solid' } },
  ]).snapshot
}

test('空间索引按层级点中，部分相交框选，逐条更新移除旧位置，不改输入', () => {
  const snapshot = fixture(), before = structuredClone(snapshot), index = createSpatialIndex(Object.values(snapshot.store))
  assert.equal(index.hitTest({ x: 60, y: 40 }), 'shape:b')
  assert.deepEqual(new Set(index.query({ x: 0, y: 0, w: 20, h: 20 })), new Set(['shape:a']))
  const moved = { ...snapshot.store['shape:b'], x: 400 }
  index.applyChanges({ added: {}, updated: { [moved.id]: [snapshot.store[moved.id], moved] }, removed: {} })
  assert.equal(index.hitTest({ x: 60, y: 40 }), 'shape:a')
  assert.equal(index.hitTest({ x: 410, y: 40 }), 'shape:b')
  index.applyChanges({ added: {}, updated: {}, removed: { [moved.id]: moved } })
  assert.equal(index.hitTest({ x: 410, y: 40 }), null)
  assert.deepEqual(snapshot, before)
})

test('父记录旋转／位移后更新子项候选；隐藏与画框裁切按祖先处理，锁定不影响纯几何查询', () => {
  let snapshot = fixture(), page = snapshot.store['shape:a'].parentId
  snapshot = executeCanvasCommands(snapshot, [
    { type: 'create_shape', id: 'shape:f', shapeType: 'frame', x: 200, y: 200, props: { w: 100, h: 100 } },
    { type: 'update', id: 'shape:a', changes: { parentId: 'shape:f', x: 80, y: 10 } },
  ]).snapshot
  const index = createSpatialIndex(Object.values(snapshot.store), page)
  assert.equal(index.hitTest({ x: 290, y: 220 }), 'shape:a')
  assert.equal(index.hitTest({ x: 320, y: 220 }), null, '画框外的子项不可点中')
  const old = snapshot.store['shape:f'], next = { ...old, x: 500, rotation: Math.PI / 2 }
  index.applyChanges({ added: {}, updated: { [old.id]: [old, next] }, removed: {} })
  assert.equal(index.hitTest({ x: 480, y: 290 }), 'shape:a')
  assert.equal(index.hitTest({ x: 290, y: 220 }), null)
  index.applyChanges({ added: {}, updated: { [old.id]: [next, { ...next, isLocked: true }] }, removed: {} })
  assert.equal(index.hitTest({ x: 480, y: 290 }), 'shape:a', '锁定是编辑层规则，不能藏在几何查询里')
})

test('粗描边在放大视角下仍能命中外框外的实际边线', () => {
  const snapshot = executeCanvasCommands(fixture(), [{ type: 'update', id: 'shape:a', changes: { x: 0, y: 0, props: { w: 100, h: 80, size: 'xl', fill: 'none' } } }]).snapshot
  const index = createSpatialIndex(Object.values(snapshot.store))
  assert.equal(index.hitTest({ x: -2, y: 40 }, .5), 'shape:a')
})

test('旋转画框外被完全裁掉的子项不进入框选', () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:f', shapeType: 'frame', rotation: Math.PI / 4, props: { w: 100, h: 100 } },
    { type: 'create_shape', id: 'shape:c', shapeType: 'geo', parentId: 'shape:f', x: 110, y: 0, props: { w: 20, h: 20, fill: 'solid' } },
  ]).snapshot
  const index = createSpatialIndex(Object.values(snapshot.store))
  assert.ok(!index.query({ x: 65, y: 90, w: 1, h: 1 }).includes('shape:c'))
})
