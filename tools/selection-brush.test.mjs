import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionFixture, shape } from './selection-fixture.mjs'
import { checkedOverlays } from '../renderer/overlays.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ScribbleOverlay } from '../renderer/scribble-overlay.js'

async function brush(f, a, b, modifiers = {}) {
  f.pointer('down', ...a, modifiers); f.pointer('move', ...b, modifiers); await f.pointer('up', ...b, modifiers)
}

test('Shift 框选只追加且不减选；Shift 点击仍逐个增减', async () => {
  const f = await selectionFixture()
  try {
    await f.click(120, 120); await f.click(320, 120, { shiftKey: true })
    await brush(f, [50, 50], [200, 200], { shiftKey: true })
    assert.deepEqual(f.selected(), ['shape:a', 'shape:b'])
    await brush(f, [190, 210], [300, 310], { shiftKey: true })
    assert.deepEqual(f.selected(), ['shape:a', 'shape:b', 'shape:c'])
    await f.click(120, 120, { shiftKey: true }); assert.deepEqual(f.selected(), ['shape:b', 'shape:c'])
    await f.click(120, 120, { shiftKey: true }); assert.deepEqual(f.selected(), ['shape:b', 'shape:c', 'shape:a'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('完全包含按组的完整外框判断；画框必须包住，局部框选只选可见子形状', async () => {
  const f = await selectionFixture([shape('a', 100, 100), shape('b', 300, 100), { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }, shape('frame', 600, 100, { shapeType: 'frame', props: { w: 200, h: 200 } }), shape('child', 20, 20, { parentId: 'shape:frame' })])
  try {
    await brush(f, [50, 50], [200, 200]); assert.deepEqual(f.selected(), ['shape:g'])
    f.interaction.setWrapMode(true)
    await brush(f, [50, 50], [200, 200]); assert.deepEqual(f.selected(), [])
    await brush(f, [50, 50], [400, 200]); assert.deepEqual(f.selected(), ['shape:g'])
    f.interaction.setWrapMode(false)
    await brush(f, [590, 110], [640, 140]); assert.deepEqual(f.selected(), ['shape:child'])
    await brush(f, [590, 90], [810, 310]); assert.deepEqual(f.selected(), ['shape:frame'])
  } finally { f.close() }
})

test('Alt 涂抹检查整段路径、累积命中；取消恢复选择，松手不写画板', async () => {
  const f = await selectionFixture()
  try {
    await f.click(220, 240)
    f.pointer('down', 50, 130, { altKey: true }); f.pointer('move', 450, 130, { altKey: true })
    assert.equal(f.state().mode, 'scribble')
    assert.deepEqual(new Set(f.selected()), new Set(['shape:a', 'shape:b']))
    assert.ok(f.state().overlays.some(o => o.kind === 'scribble'))
    f.pointer('move', 50, 130, { altKey: true }); assert.equal(f.selected().length, 2)
    f.pointer('cancel', 50, 130)
    assert.deepEqual(f.selected(), ['shape:c']); assert.equal(f.state().scribble, null)
    await brush(f, [50, 130], [450, 130], { altKey: true, shiftKey: true })
    assert.deepEqual(new Set(f.selected()), new Set(['shape:a', 'shape:b', 'shape:c']))
    assert.equal(f.state().scribble, null)
    assert.equal(f.commits.length, 0); assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

test('涂抹不按几何外框误选空心形状，不穿过旋转画框的裁切区域，不拼接箭头装饰', async () => {
  const f = await selectionFixture([
    shape('hollow', 100, 100, { props: { w: 200, h: 200, geo: 'ellipse', fill: 'none' } }),
    shape('frame', 600, 100, { shapeType: 'frame', rotation: Math.PI / 2, props: { w: 200, h: 100 } }),
    shape('clipped', -50, 20, { parentId: 'shape:frame' }),
    shape('arrow', 800, 100, { shapeType: 'arrow', props: { start: { x: 0, y: 0 }, end: { x: 150, y: 100 }, arrowheadEnd: 'triangle' } }),
  ])
  try {
    await brush(f, [190, 190], [210, 210], { altKey: true }); assert.deepEqual(f.selected(), [])
    await brush(f, [50, 200], [350, 200], { altKey: true }); assert.deepEqual(f.selected(), ['shape:hollow'])
    await brush(f, [530, 60], [590, 60], { altKey: true }); assert.deepEqual(f.selected(), [])
    await brush(f, [530, 110], [590, 110], { altKey: true }); assert.deepEqual(f.selected(), ['shape:clipped'])
    await brush(f, [870, 140], [880, 160], { altKey: true }); assert.deepEqual(f.selected(), ['shape:arrow'])
  } finally { f.close() }
})

test('Shift 锁轴实时切换，释放恢复自由拖动；Esc 不保存，完成一次只提交一次', async () => {
  const f = await selectionFixture()
  try {
    f.pointer('down', 130, 130); f.pointer('move', 163, 150)
    assert.deepEqual([f.session.store.get('shape:a').x, f.session.store.get('shape:a').y], [133, 120])
    f.pointer('move', 164, 151, { shiftKey: true })
    assert.deepEqual([f.session.store.get('shape:a').x, f.session.store.get('shape:a').y], [134, 100])
    f.pointer('move', 150, 185, { shiftKey: true })
    assert.deepEqual([f.session.store.get('shape:a').x, f.session.store.get('shape:a').y], [100, 155])
    f.pointer('move', 150, 185)
    assert.deepEqual([f.session.store.get('shape:a').x, f.session.store.get('shape:a').y], [120, 155])
    f.input({ type: 'key_down', key: 'Escape' }); assert.deepEqual(f.current(), f.initial)
    f.pointer('down', 130, 130); f.pointer('move', 180, 150, { shiftKey: true }); await f.pointer('up', 180, 150, { shiftKey: true })
    assert.equal(f.commits.length, 1); assert.equal(f.current().store['shape:a'].y, 100)
  } finally { f.close() }
})

test('新覆盖层逐点验证、拷贝冻结、丢弃额外字段并限制长度；线宽仅经令牌逆缩放', () => {
  const input = { kind: 'scribble', points: [{ x: 2, y: 3 }, { x: 8, y: 10 }], bogus: true }
  const [checked] = checkedOverlays([input])
  assert.deepEqual(checked.bounds, { x: 2, y: 3, w: 6, h: 7 }); assert.equal(checked.bogus, undefined)
  input.points[0].x = 999; assert.equal(checked.points[0].x, 2)
  assert.throws(() => checked.points[0].x = 50, TypeError)
  for (const points of [[], [{ x: Infinity, y: 1 }], Array.from({ length: 257 }, () => ({ x: 0, y: 0 }))]) assert.throws(() => checkedOverlays([{ kind: 'scribble', points }]), /有限坐标/)
  const html = renderToStaticMarkup(createElement(ScribbleOverlay, { item: checked, zoom: 2 }))
  assert.match(html, /var\(--color-overlay-scribble-stroke\)/); assert.match(html, /calc\(var\(--spacing-overlay-scribble-stroke\) \/ 2\)/)
})

test('修饰键在指针静止时仍即时切换框选判据和锁轴', async () => {
  const f = await selectionFixture()
  try {
    f.pointer('down', 50, 50); f.pointer('move', 120, 120)
    f.input({ type: 'key_down', key: 'Control', ctrlKey: true }); assert.deepEqual(f.selected(), [])
    f.input({ type: 'key_up', key: 'Control' }); assert.deepEqual(f.selected(), ['shape:a'])
    f.pointer('cancel', 120, 120)
    f.pointer('down', 130, 130); f.pointer('move', 160, 150)
    f.input({ type: 'key_down', key: 'Shift', shiftKey: true })
    assert.equal(f.session.store.get('shape:a').y, 100)
    f.input({ type: 'key_up', key: 'Shift' }); assert.equal(f.session.store.get('shape:a').y, 120)
    f.pointer('cancel', 160, 150); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('稀疏点数组被覆盖层校验拒绝，不产生 NaN 外框', () => {
  assert.throws(() => checkedOverlays([{ kind: 'scribble', points: [{ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }] }]), /有限尺寸/)
  for (const points of [Array(1), [{ x: 1, y: 2 }, , { x: 3, y: 4 }]]) assert.throws(() => checkedOverlays([{ kind: 'scribble', points }]), /有限坐标/)
})

test('同一条涂抹轨迹不因事件稀疏而漏掉粗描边；箭头描边在记录宽度变动后仍命中', async () => {
  const f = await selectionFixture([
    shape('rect', 100, 100, { props: { w: 200, h: 200, fill: 'none', size: 'xl' } }),
    shape('arrow', 600, 100, { shapeType: 'arrow', props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, size: 'xl', arrowheadEnd: 'none' } }),
  ])
  try {
    await brush(f, [50, 96], [350, 96], { altKey: true }); assert.deepEqual(f.selected(), ['shape:rect'])
    f.pointer('down', 50, 96, { altKey: true }); f.pointer('move', 200, 96, { altKey: true }); await f.pointer('up', 350, 96, { altKey: true })
    assert.deepEqual(f.selected(), ['shape:rect'])
    await brush(f, [550, 96], [850, 96], { altKey: true }); assert.deepEqual(f.selected(), ['shape:arrow'])
    await f.remote([{ type: 'update', id: 'shape:arrow', changes: { props: { size: 's' } } }])
    await brush(f, [550, 96], [850, 96], { altKey: true }); assert.deepEqual(f.selected(), [])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
