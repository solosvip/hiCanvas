import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getShapeBounds, createSpatialIndex } from '../renderer/geometry.js'
import { fixture, subject, scale } from './scale-fixtures.mjs'

test('视频保存外框进入几何和空间索引，缩放后清除旧区域', () => {
  const before = fixture('video'), shape = before.store[subject]
  assert.deepEqual(getShapeBounds(shape), { x: 0, y: 0, w: 320, h: 180 })
  const index = createSpatialIndex(Object.values(before.store))
  assert.ok(index.query({ x: 310, y: 260, w: 1, h: 1 }).includes(subject))
  const next = scale(before, { x: .5, y: .5 }).snapshot.store[subject]
  index.applyChanges({ updated: { [subject]: [shape, next] } })
  assert.ok(index.query({ x: 310, y: 260, w: 1, h: 1 }).includes(subject))
  assert.equal(index.query({ x: 610, y: 420, w: 1, h: 1 }).includes(subject), false)
})

for (const mode of ['resize_bounds', 'scale_shape']) test(`${mode}：视频默认等比、可显式解锁；最小边长仍为1`, () => {
  const before = fixture('video')
  const locked = scale(before, { x: 2, y: 1.5 }, { mode }).snapshot.store[subject]
  assert.deepEqual([locked.props.w, locked.props.h], [640, 360])
  const unlocked = scale(before, { x: 2, y: 1.5 }, { mode, lockAspectRatio: false }).snapshot.store[subject]
  assert.deepEqual([unlocked.props.w, unlocked.props.h], [640, 270])
  const tiny = scale(before, { x: .001, y: .002 }, { mode }).snapshot.store[subject]
  assert.deepEqual([tiny.props.w, tiny.props.h], [1, 1])
})
