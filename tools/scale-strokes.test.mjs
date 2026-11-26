import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { b64Vecs } from '@tldraw/tlschema'
import { getStrokeGeometry, pointInShape } from '../renderer/geometry.js'

const shape = (type, scaleX = 1, scaleY = 1) => ({ type, props: {
  color: type === 'draw' ? 'black' : 'yellow', size: 'm', scale: 1, scaleX, scaleY,
  fill: 'none', dash: 'solid', isComplete: true, isPen: false,
  segments: [{ type: 'straight', path: b64Vecs.encodePoints([{ x: 0, y: 0, z: .5 }, { x: 200, y: 0, z: .5 }]) }],
} })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

for (const [type, thickness, outside] of [['draw', 4.5, 3], ['highlight', 26.88, 14]]) {
  test(`${type}：只缩中心线，纵向放大不改变线宽或点中范围`, () => {
    const before = shape(type), after = shape(type, 2, 2)
    near(getStrokeGeometry(before).bounds.h, thickness)
    near(getStrokeGeometry(after).bounds.h, thickness)
    assert.equal(pointInShape(after, { x: 200, y: 0 }), true)
    assert.equal(pointInShape(after, { x: 200, y: outside }), false)
    assert.deepEqual(after.props.segments, before.props.segments)
  })
  test(`${type}：反射后线宽与点中半径仍保持原值`, () => {
    const after = shape(type, -2, -2)
    near(getStrokeGeometry(after).bounds.h, thickness)
    assert.equal(pointInShape(after, { x: -200, y: 0 }), true)
    assert.equal(pointInShape(after, { x: -200, y: outside }), false)
  })
}

for (const type of ['draw', 'highlight']) for (const mode of ['resize_bounds', 'scale_shape']) test(`${type}/${mode}：命令仅改变笔迹轴倍率，编码、压力和线宽比例保持原样`, async () => {
  const { fixture, subject, scale } = await import('./scale-fixtures.mjs')
  const before = fixture(type, { scaleX: 1.5, scaleY: .5 })
  const result = scale(before, { x: -2, y: 1.5 }, { mode })
  const shape = result.snapshot.store[subject]
  assert.deepEqual([shape.x, shape.y, shape.props.scaleX, shape.props.scaleY, shape.props.scale], [300, 250, -3, .75, 1])
  assert.deepEqual(shape.props.segments, before.store[subject].props.segments)
})

test('scaleX/Y=1 的三份笔迹图鉴几何与改动前一致（精确到万分之一画布单位）', async () => {
  const { createHash } = await import('node:crypto')
  const { createStrokeGallery } = await import('./renderer-preview/stroke-fixtures.js')
  // Captured from the pre-#105 geometry, not from the new implementation.
  // Numbers are rounded to 1e-4 canvas units before hashing: Apple-silicon
  // and Linux x64 V8 builds can differ in the last floating-point bit of
  // trigonometric helpers, which made the raw-byte hash pass locally but fail
  // in CI. 1e-4 units is far below any visible change in a stroke outline.
  const rounded = (_key, value) => typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value
  for (const [gallery, expected] of [
    ['stroke-styles', '1730a7e740751858a24e8e514461795ff2eb460a61e6cc452b2ee16e26f46f06'],
    ['stroke-details', 'fd8896d29635cb3514b1e270d7eb88b4bdd9bfd3fb3db1d006429da4ab89d455'],
    ['stroke-highlights', '4622f667f8ac80ed0e4bc8327921ff8d8b74b051a1ec5edc17470c0485cd34e7'],
  ]) {
    const shapes = Object.values(createStrokeGallery(gallery).snapshot.store).filter(s => ['draw', 'highlight'].includes(s.type))
    assert.equal(createHash('sha256').update(JSON.stringify(shapes.map(getStrokeGeometry), rounded)).digest('hex'), expected, gallery)
  }
})
