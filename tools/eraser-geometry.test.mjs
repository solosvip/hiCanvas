import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawFixture } from './draw-fixture.mjs'

const geo = (id, x, y, props = {}, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { w: 100, h: 80, fill: 'solid', ...props }, ...extra })
const fixture = (commands, options) => drawFixture(commands, { toolIds: ['select', 'hand', 'eraser'], ...options })
const erased = f => [...f.state().erasingIds].sort()

// Independent native legacy samples: 8 CSS px outside a tiny rectangle hits;
// 9 CSS px misses, including an entire segment whose two endpoints miss.
for (const { z, x, from, to, hit, miss } of [
  { z: .5, x: 185, from: 120, to: 270, hit: 170, miss: 171 },
  { z: 1, x: 370, from: 240, to: 540, hit: 332, miss: 333 },
  { z: 2, x: 740, from: 480, to: 1080, hit: 656, miss: 657 },
]) for (const mode of ['click', 'drag']) for (const [y, expected] of [[hit, ['shape:small']], [miss, []]]) test(`旧版8px容差 z=${z} ${mode} y=${y}`, async () => {
  const f = await fixture([geo('small', 366, 316, { w: 8, h: 8 })], { camera: { x: 0, y: 0, z } })
  try {
    f.key('e'); f.pointer('down', mode === 'click' ? x : from, y)
    if (mode === 'drag') f.pointer('move', to, y)
    assert.deepEqual(erased(f), expected)
  } finally { f.close() }
})

test('框内子对象按裁剪后的可见几何擦除；空白框内不擦，边线擦整框', async () => {
  const f = await fixture([
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 280, y: 260, props: { w: 200, h: 150 } },
    geo('child', 20, 20, { w: 70, h: 60 }, { parentId: 'shape:frame' }),
    geo('clipped', 180, 90, { w: 80, h: 50 }, { parentId: 'shape:frame' }),
  ])
  try {
    f.key('e')
    for (const [x, y, expected] of [[320, 310, ['shape:child']], [420, 370, []], [280, 350, ['shape:frame']], [470, 370, ['shape:clipped']], [510, 370, []]]) {
      f.pointer('down', x, y); assert.deepEqual(erased(f), expected); f.key('Escape')
    }
  } finally { f.close() }
})

test('空心几何中心不擦，线/箭头用真实路径；旋转父框保留裁剪', async () => {
  const f = await fixture([
    geo('hollow', 100, 100, { w: 200, h: 200, geo: 'ellipse', fill: 'none' }),
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 650, y: 200, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, arrowheadEnd: 'none', size: 'xl' } },
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 600, y: 400, rotation: Math.PI / 2, props: { w: 200, h: 100 } },
    geo('child', -50, 20, { w: 100, h: 60 }, { parentId: 'shape:frame' }),
  ])
  try {
    f.key('e')
    for (const [x, y, expected] of [[200, 200, []], [100, 200, ['shape:hollow']], [750, 200, ['shape:arrow']], [750, 212, []], [560, 420, ['shape:child']], [560, 360, []], [608, 500, ['shape:frame']]]) {
      f.pointer('down', x, y); assert.deepEqual(erased(f), expected, `${x},${y}`); f.key('Escape')
    }
  } finally { f.close() }
})

for (const type of ['line', 'arrow']) test(`${type}粗描边在2倍视角可点/段擦；宽度更新后粗筛同步，透明仍可擦`, async () => {
  const props = type === 'line' ? { points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 200, y: 0 } } }
    : { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'none' }
  const f = await fixture([{ type: 'create_shape', id: 'shape:thick', shapeType: type, x: 100, y: 100, props: { ...props, size: 'xl' } },
    { type: 'update', id: 'shape:thick', changes: { opacity: 0 } }], { camera: { x: 0, y: 0, z: 2 } })
  try {
    f.key('e'); f.pointer('down', 300, 209); assert.deepEqual(erased(f), ['shape:thick']); f.key('Escape')
    f.pointer('down', 100, 209); f.pointer('move', 700, 209); assert.deepEqual(erased(f), ['shape:thick']); f.key('Escape')
    await f.remote([{ type: 'update', id: 'shape:thick', changes: { props: { size: 's' } } }])
    f.pointer('down', 300, 209); assert.deepEqual(erased(f), [])
  } finally { f.close() }
})

for (const fill of ['solid', 'none']) test(`箭头三角端帽${fill}按实际填充区域命中，不用端帽外框代替`, async () => {
  const f = await fixture([{ type: 'create_shape', id: 'shape:cap', shapeType: 'arrow', x: 100, y: 100, props: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, size: 'xl', scale: 2, arrowheadEnd: 'triangle', fill } }], { camera: { x: 0, y: 0, z: 2 } })
  try {
    f.key('e'); f.pointer('down', 718, 222)
    assert.deepEqual(erased(f), fill === 'solid' ? ['shape:cap'] : [])
  } finally { f.close() }
})
