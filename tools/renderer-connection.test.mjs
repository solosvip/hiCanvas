import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createConnectionGallery } from './renderer-preview/arrow-gallery.js'
import { getConnectionGeometry, createConnectionContext, getBoundArrowIds, hitTestCanvas, getShapePageBounds, pointInShape, shapeToPagePoint, pageToShapePoint } from '../renderer/geometry.js'

const close = (a, b, tolerance = .05) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)
const geometry = (mode, id) => { const { snapshot } = createConnectionGallery(mode); return getConnectionGeometry(snapshot.store[id], snapshot) }

test('线条按 index 顺序连线，曲线穿过顶点，线身命中不填满外框，负坐标与零长度有限', () => {
  const { snapshot } = createConnectionGallery('lines'), record = snapshot.store['shape:line-0-1']
  const g = getConnectionGeometry(record)
  assert.equal(g.hit({ x: 50, y: 50 }), true)
  assert.equal(g.hit({ x: 110, y: 0 }), false)
  const curve = geometry('lines', 'shape:line-1-1')
  assert.ok(curve.path.d.includes('C'))
  assert.equal(curve.hit({ x: 100, y: 100 }), true)
  assert.equal(curve.hit({ x: 100, y: 50 }), false)
  const before = structuredClone(record)
  getConnectionGeometry({ ...record, props: { ...record.props, points: { b: { id: 'b', index: 'a2', x: -40, y: -40 }, a: { id: 'a', index: 'a1', x: -40, y: -40 } } } })
  assert.deepEqual(record, before)
})

test('弧线保留 bend 正负及大于半圆的弧，折线每段正交，标签沿路径放置并独立命中', () => {
  for (const [i, y] of [[0, 0], [1, 55], [2, -55], [3, 180]]) {
    const g = geometry('routes', `shape:route-${i}`)
    close(g.path.at(.5).x, 130); close(g.path.at(.5).y, y)
    close(g.label.size, 20); close(g.label.bounds.h, 27)
    assert.equal(g.hit(g.label.center), true)
    assert.equal(g.hit({ x: g.label.center.x, y: g.label.center.y + 12 }), true, '标签范围在细线外仍命中')
  }
  const g = geometry('routes', 'shape:route-4')
  for (let i = 1; i < g.path.points.length; i++) assert.ok(g.path.points[i - 1].x === g.path.points[i].x || g.path.points[i - 1].y === g.path.points[i].y)
  close(g.path.at(.5).x, 130); close(g.path.at(.5).y, 50)
})

test('两端覆盖全部 MIT 端帽枚举与四档尺寸，端点及线宽独立于相机', () => {
  for (const head of ['arrow', 'triangle', 'square', 'dot', 'pipe', 'diamond', 'inverted', 'bar', 'none']) {
    const g = geometry('arrows', `shape:head-${head}`)
    assert.equal(g.heads.length, ['none', 'pipe'].includes(head) ? 0 : 2)
    close(g.path.at(0).x, 0); close(g.path.at(1).x, 260)
    assert.ok(g.heads.flatMap(h => h.points).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
  }
  for (const [size, width] of Object.entries({ s: 2, m: 3.5, l: 5, xl: 10 })) close(geometry('arrows', `shape:head-size-${size}`).width, width)
})

test('矩形、椭圆、旋转目标与旋转框内目标绑定：接触点在轮廓上，绘制端点留旧版间隙', () => {
  const { snapshot } = createConnectionGallery('bindings'), context = createConnectionContext(snapshot), before = structuredClone(snapshot)
  for (let i = 0; i < 4; i++) {
    const arrow = snapshot.store[`shape:bound-${i}`], target = snapshot.store[`shape:target-${i}`], g = getConnectionGeometry(arrow, context)
    const local = pageToShapePoint(snapshot, target.id, shapeToPagePoint(snapshot, arrow.id, g.contacts.end))
    if (i === 1) close(((local.x - 70) / 70) ** 2 + ((local.y - 50) / 50) ** 2, 1, .005)
    else close(Math.min(Math.abs(local.x), Math.abs(local.y), Math.abs(local.x - 140), Math.abs(local.y - 100)), 0, .5)
    close(Math.hypot(g.contacts.end.x - g.path.at(1).x, g.contacts.end.y - g.path.at(1).y), 13.5)
  }
  close(getConnectionGeometry(snapshot.store['shape:bound-0'], context).contacts.end.x, 440)
  close(getConnectionGeometry(snapshot.store['shape:bound-0'], context).path.at(1).x, 426.5)
  assert.deepEqual(snapshot, before)
})

test('精确、指定锚点、不带端帽、解绑和目标缺失均按记录处理，不修改数据', () => {
  const { snapshot } = createConnectionGallery('bindings'), arrow = snapshot.store['shape:bound-0'], binding = snapshot.store['binding:connection-0']
  binding.props.isExact = true; binding.props.isPrecise = true; binding.props.normalizedAnchor = { x: .75, y: .25 }
  let g = getConnectionGeometry(arrow, snapshot)
  close(g.path.at(1).x, 545); close(g.path.at(1).y, -25)
  binding.props.isExact = false; binding.props.isPrecise = false; arrow.props.arrowheadEnd = 'none'
  g = getConnectionGeometry(arrow, snapshot); close(g.path.at(1).x, 440)
  delete snapshot.store[binding.toId]
  g = getConnectionGeometry(arrow, snapshot); close(g.path.at(1).x, 510)
})

test('依赖查询包含子孙并去重，绑定换目标时旧索引清除，组与箭头祖先变化只通知相关箭头', () => {
  const { snapshot } = createConnectionGallery('bindings'), context = createConnectionContext(snapshot)
  assert.deepEqual(getBoundArrowIds(context, 'shape:binding-frame'), ['shape:bound-3'])
  assert.deepEqual(getBoundArrowIds(snapshot, snapshot.store['shape:target-0']), ['shape:bound-0'])
  const old = snapshot.store['binding:connection-0'], next = { ...old, toId: 'shape:target-1' }
  context.applyChanges({ updated: { [old.id]: [old, next] } })
  assert.deepEqual(getBoundArrowIds(context, 'shape:target-0'), [])
  assert.deepEqual(new Set(getBoundArrowIds(context, 'shape:target-1')), new Set(['shape:bound-0', 'shape:bound-1']))
})

test('绑定折线按指定锚点朝向绕出目标外框，四档外绕与短末段端帽和旧版测量一致', () => {
  const { snapshot } = createConnectionGallery('bindings')
  for (const [i, size, escape, gap] of [[0, 's', 28, 12.75], [1, 'm', 36, 13.5], [2, 'l', 44, 14.25], [3, 'xl', 66, 16.75]]) {
    const arrow = snapshot.store[`shape:bound-${i}`], target = snapshot.store[`shape:target-${i}`], binding = snapshot.store[`binding:connection-${i}`]
    Object.assign(arrow.props, { kind: 'elbow', size })
    Object.assign(target, { x: 500, y: arrow.y - 50, parentId: arrow.parentId, rotation: 0 }); target.props.geo = 'rectangle'
    Object.assign(binding.props, { isPrecise: true, normalizedAnchor: { x: .25, y: .1 } })
    const g = getConnectionGeometry(arrow, snapshot)
    const route = g.path.points.filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y)
    assert.equal(route.length, 4)
    close(route[1].x, 0); close(route[1].y, -50 - escape)
    close(route[2].x, 475); close(route[2].y, -50 - escape)
    close(route[3].x, 475); close(route[3].y, -50 - gap)
    if (size === 'xl') close(Math.abs(g.heads[0].points[0].x - 475), 12.3125)
  }
})

test('组的子形状改变外框时，依赖查询包含组的绑定且不包含无关兄弟的绑定', () => {
  const { snapshot } = createConnectionGallery('bindings')
  const group = snapshot.store['shape:binding-frame']
  group.type = 'group'; group.props = {}
  snapshot.store['binding:connection-0'].toId = group.id
  const reader = createConnectionContext(snapshot)
  assert.deepEqual(new Set(getBoundArrowIds(reader, 'shape:target-3')), new Set(['shape:bound-0', 'shape:bound-3']))
  assert.deepEqual(getBoundArrowIds(reader, 'shape:target-1'), ['shape:bound-1'])
})

test('两端同时绑定时，直线、弧线及两种折线的端点与旧版黑盒样本相差不到半单位', () => {
  // Legacy synthetic "Both terminals bound", 2026-11-25; coordinates are
  // observed SVG output, not restricted implementation details.
  const samples = [
    [false, 0, false, [213.2822, 115.1422, 486.7178, 164.8578]],
    [false, 55, false, [212.0057, 151.5907, 486.6312, 198.1096]],
    [true, 0, false, [213.5, 100, 486.5, 180]],
    [true, 0, true, [95, 36.5, 535, 116.5]],
  ]
  for (const [elbow, bend, precise, expected] of samples) {
    const { snapshot } = createConnectionGallery('bindings'), arrow = snapshot.store['shape:bound-0'], target = snapshot.store['shape:target-0'], binding = snapshot.store['binding:connection-0']
    Object.assign(arrow, { x: 0, y: 0 }); Object.assign(arrow.props, { kind: elbow ? 'elbow' : 'arc', bend, start: { x: 130, y: 100 }, end: { x: 570, y: 180 }, arrowheadStart: 'triangle' })
    Object.assign(target, { x: 500, y: 130 })
    snapshot.store['shape:both-start'] = { ...target, id: 'shape:both-start', x: 60, y: 50 }
    Object.assign(binding.props, { isPrecise: precise, normalizedAnchor: precise ? { x: .25, y: .1 } : { x: .5, y: .5 } })
    snapshot.store['binding:both-start'] = { ...binding, id: 'binding:both-start', toId: 'shape:both-start', props: { ...binding.props, terminal: 'start' } }
    const g = getConnectionGeometry(arrow, snapshot), start = g.path.at(0), end = g.path.at(1)
    ;[start.x, start.y, end.x, end.y].forEach((value, i) => close(value, expected[i], .5))
  }
})

test('统一登记入口按上下文查询绑定线身和标签，外框含负坐标、端帽和标签', () => {
  const { snapshot, viewState } = createConnectionGallery('bindings'), arrow = snapshot.store['shape:bound-0']
  snapshot.store['shape:target-0'].x = 900
  const point = { x: arrow.x + 650, y: arrow.y }
  assert.equal(hitTestCanvas(snapshot, point, { x: 0, y: 0, z: 1 }, viewState.currentPageId), arrow.id)
  assert.equal(pointInShape(arrow, { x: 650, y: 0 }, 0, snapshot), true)
  const box = getShapePageBounds(snapshot, arrow.id)
  assert.ok(box.x + box.w > 880)
  assert.ok(box.y < arrow.y && box.y + box.h > arrow.y)
})
