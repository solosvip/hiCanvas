import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, subject, scale, near } from './scale-fixtures.mjs'

for (const mode of ['resize_bounds', 'scale_shape']) test(`${mode}：混选便签只移动中心，保留固有尺寸及已有成长`, () => {
  const before = fixture('note', {}, { peer: true })
  const result = scale(before, { x: 660 / 560, y: 230 / 200 }, { ids: [subject, 'shape:peer'], mode })
  const note = result.snapshot.store[subject]
  // Native bottom-right +100,+30, selection 560x200, 2026-11-25.
  near(note.x, 317.8571428571429); near(note.y, 265)
  assert.deepEqual(note.props, before.store[subject].props)
})

for (const [props, factors, x, y] of [
  [{}, { x: 660 / 560, y: 230 / 200 }, 367.8571428571429, 280],
  [{ scale: 1.5, growY: 120 }, { x: 660 / 560, y: 510 / 480 }, 376.7857142857143, 280],
]) test('组内便签叠加影子组位移，组记录保持原样', () => {
  const before = fixture('note', props, { group: true })
  const result = scale(before, factors, { ids: ['shape:group'] })
  const note = result.snapshot.store[subject]
  near(note.x + 300, x); near(note.y + 250, y)
  assert.deepEqual(note.props, before.store[subject].props)
  assert.deepEqual(result.snapshot.store['shape:group'], before.store['shape:group'])
  assert.deepEqual(new Set(result.results[0].shapeIds), new Set([subject, 'shape:peer']))
})

test('嵌套组便签落点与原生样本一致，两层组记录均不改', () => {
  const before = fixture('note', {}, { group: true, nested: true })
  const result = scale(before, { x: 1.125, y: 1.15 }, { ids: ['shape:group'] })
  const note = result.snapshot.store[subject]
  near(note.x + 300, 397.5); near(note.y + 250, 295)
  assert.deepEqual(result.snapshot.store['shape:group'], before.store['shape:group'])
  assert.deepEqual(result.snapshot.store['shape:inner'], before.store['shape:inner'])
  near(result.snapshot.store['shape:peer'].x + 300, 817.5)
  near(result.snapshot.store['shape:outer-peer'].x + 100, 1087.5)
})

for (const group of [false, true]) test(`书签${group ? '组选随组移动' : '直接混选跳过'}，尺寸和内容保持原样`, () => {
  const before = fixture('bookmark', {}, { group, peer: true })
  const result = scale(before, { x: 660 / 560, y: 185 / 155 }, { ids: group ? ['shape:group'] : [subject, 'shape:peer'] })
  const bookmark = result.snapshot.store[subject]
  near(bookmark.x + (group ? 300 : 0), group ? 350 : 300)
  near(bookmark.y + (group ? 250 : 0), group ? 265 : 250)
  assert.deepEqual(bookmark.props, before.store[subject].props)
  assert.equal(result.results[0].shapeIds.includes(subject), group)
  if (group) assert.deepEqual(result.snapshot.store['shape:group'], before.store['shape:group'])
})

test('显式锁比例同时作用于固定尺寸叶子和影子组位移', () => {
  const before = fixture('note', {}, { group: true })
  const result = scale(before, { x: 2, y: 1.5 }, { ids: ['shape:group'], lockAspectRatio: true })
  near(result.snapshot.store[subject].x + 300, 680)
  near(result.snapshot.store[subject].y + 250, 450)
})
