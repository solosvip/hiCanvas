import '../tools/test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction, CanvasEditError } from '../engine/index.js'
import { shapeToPagePoint, getShapeBounds } from '../renderer/geometry.js'

const id = name => `shape:${name}`
const create = (name, extra = {}) => ({ type: 'create_shape', id: id(name), shapeType: 'geo', props: { w: 100, h: 50 }, ...extra })
const run = (snapshot, ...commands) => executeCanvasCommands(snapshot, commands)
const seed = (...commands) => run(createCanvasSnapshot(), ...commands).snapshot
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`)
const point = (actual, expected) => { near(actual.x, expected.x); near(actual.y, expected.y) }

test('根级形状绕指定画布点旋转，原快照保持不变', () => {
  const initial = seed(create('A', { x: 100, y: 0 }), create('B', { x: 200, y: 100 }))
  const before = structuredClone(initial)
  const result = run(initial, { type: 'rotate_shapes', ids: [id('A'), id('B')], origin: { x: 0, y: 0 }, angle: Math.PI / 2 })
  point(result.snapshot.store[id('A')], { x: 0, y: 100 })
  point(result.snapshot.store[id('B')], { x: -100, y: 200 })
  near(result.snapshot.store[id('A')].rotation, Math.PI / 2)
  assert.deepEqual(initial, before)
})

test('旋转父容器与嵌套父链内的形状，落点按画布坐标计算', () => {
  const initial = seed(
    create('F', { shapeType: 'frame', x: 100, y: 200, rotation: Math.PI / 2 }),
    create('A', { parentId: id('F'), x: 20, y: 30, rotation: Math.PI / 6 }),
    create('G', { shapeType: 'frame', parentId: id('F'), x: 40, y: 50, rotation: -Math.PI / 2 }),
    create('B', { parentId: id('G'), x: 10, y: 15, rotation: Math.PI / 4 })
  )
  // A starts at (70,220), B at (60,255). A quarter turn around
  // (100,200) places them at (80,170) and (45,160), respectively.
  const result = run(initial, { type: 'rotate_shapes', ids: [id('A'), id('B')], origin: { x: 100, y: 200 }, angle: Math.PI / 2 })
  point(shapeToPagePoint(result.snapshot, id('A'), { x: 0, y: 0 }), { x: 80, y: 170 })
  point(shapeToPagePoint(result.snapshot, id('B'), { x: 0, y: 0 }), { x: 45, y: 160 })
  point(result.snapshot.store[id('A')], { x: -30, y: 20 })
  near(result.snapshot.store[id('A')].rotation, Math.PI * 2 / 3)
  near(result.snapshot.store[id('B')].rotation, Math.PI * 3 / 4)
  assert.deepEqual(result.snapshot.store[id('F')], initial.store[id('F')])
  assert.deepEqual(result.snapshot.store[id('G')], initial.store[id('G')])
})

test('下一刻度按单个形状的画布朝向或调用方参考角计算，共用一个转角', () => {
  const initial = seed(create('F', { shapeType: 'frame', rotation: Math.PI / 2 }), create('A', { parentId: id('F'), rotation: Math.PI / 36 }), create('B', { rotation: Math.PI / 6 }))
  const single = run(initial, { type: 'rotate_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, step: Math.PI / 12 })
  near(single.snapshot.store[id('A')].rotation, Math.PI / 12, '95° -> 105° in page space')
  const exact = run(single.snapshot, { type: 'rotate_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, step: Math.PI / 12, direction: -1 })
  near(exact.snapshot.store[id('A')].rotation, 0)
  const multi = run(initial, { type: 'rotate_shapes', ids: [id('A'), id('B')], origin: { x: 0, y: 0 }, step: Math.PI / 12 })
  near(multi.snapshot.store[id('A')].rotation, Math.PI / 9)
  near(multi.snapshot.store[id('B')].rotation, Math.PI / 4)
  const reference = run(initial, { type: 'rotate_shapes', ids: [id('A'), id('B')], origin: { x: 0, y: 0 }, step: Math.PI / 12, referenceAngle: -Math.PI / 36, direction: -1 })
  near(reference.snapshot.store[id('A')].rotation, Math.PI * 71 / 36)
  near(reference.snapshot.store[id('B')].rotation, Math.PI / 9)
})

test('根级几何形状按横纵倍率缩放，尺寸与形状中心围绕指定原点变化', () => {
  const initial = seed(create('A', { x: 200, y: 150, props: { w: 200, h: 100 } }))
  const result = run(initial, { type: 'scale_shapes', ids: [id('A')], origin: { x: 50, y: 50 }, scale: { x: 2, y: 3 } })
  const shape = result.snapshot.store[id('A')]
  point(shape, { x: 350, y: 350 })
  assert.equal(shape.props.w, 400)
  assert.equal(shape.props.h, 300)
  assert.deepEqual(initial.store[id('A')].props, seed(create('A', { props: { w: 200, h: 100 } })).store[id('A')].props)
})

test('旋转父容器与嵌套父链内缩放，90° 朝向交换尺寸轴，中心落点精确', () => {
  const initial = seed(
    create('F', { shapeType: 'frame', x: 100, y: 200, rotation: Math.PI / 2 }),
    create('A', { parentId: id('F'), x: 20, y: 30 }),
    create('G', { shapeType: 'frame', parentId: id('F'), x: 40, y: 50, rotation: -Math.PI / 2 }),
    create('B', { parentId: id('G'), x: 10, y: 15 })
  )
  const result = run(initial, { type: 'scale_shapes', ids: [id('A'), id('B')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 3 } })
  point(shapeToPagePoint(result.snapshot, id('A'), { x: 0, y: 0 }), { x: 140, y: 660 })
  point(result.snapshot.store[id('A')], { x: 460, y: -40 })
  assert.equal(result.snapshot.store[id('A')].props.w, 300)
  assert.equal(result.snapshot.store[id('A')].props.h, 100)
  point(shapeToPagePoint(result.snapshot, id('B'), { x: 0, y: 0 }), { x: 120, y: 765 })
  point(result.snapshot.store[id('B')], { x: 70, y: 525 })
  assert.equal(result.snapshot.store[id('B')].props.w, 200)
  assert.equal(result.snapshot.store[id('B')].props.h, 150)
})

test('非正交形状尺寸取较小倍率，中心仍按输入倍率变化；负倍率保持可表达的反射朝向', () => {
  const initial = seed(create('A', { x: 200, y: 150, rotation: Math.PI / 4, props: { w: 200, h: 100 } }))
  for (const [x, expectedOrigin, expectedRotation] of [
    [2, { x: 400, y: 556.0660171779823 }, Math.PI / 4],
    [-2, { x: -682.842712474619, y: 838.9087296526011 }, Math.PI * 7 / 4]
  ]) {
    const result = run(initial, { type: 'scale_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, scale: { x, y: 3 } })
    const shape = result.snapshot.store[id('A')]
    point(shape, expectedOrigin)
    near(shape.rotation, expectedRotation)
    assert.equal(shape.props.w, 400)
    assert.equal(shape.props.h, 200)
  }
})

test('图片默认锁比例、可解除，负倍率与已有翻转状态叠加', () => {
  const initial = seed(create('A', { shapeType: 'image', x: 200, y: 150, props: { w: 200, h: 100, flipX: true } }))
  const command = { type: 'scale_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 3 } }
  const locked = run(initial, command).snapshot.store[id('A')]
  point(locked, { x: 600, y: 450 })
  assert.equal(locked.props.w, 600)
  assert.equal(locked.props.h, 300)
  const side = run(initial, { ...command, mode: 'resize_bounds', handle: 'left' }).snapshot.store[id('A')]
  assert.equal(side.props.w, 600, '图片边框默认也锁定比例')
  assert.equal(side.props.h, 300)
  const unlocked = run(initial, { ...command, lockAspectRatio: false }).snapshot.store[id('A')]
  point(unlocked, { x: 400, y: 450 })
  assert.equal(unlocked.props.w, 400)
  assert.equal(unlocked.props.h, 300)
  const flipped = run(initial, { ...command, scale: { x: -2, y: -3 } }).snapshot.store[id('A')]
  point(flipped, { x: -1200, y: -750 })
  assert.equal(flipped.props.flipX, false)
  assert.equal(flipped.props.flipY, true)
})

test('直角旋转图片的负倍率只反射一次，含父链旋转时原始像素落点仍正确', () => {
  for (const [rotation, expected, localCorner, flip] of [
    [0, { x: -200, y: 0 }, { x: 200, y: 0 }, 'flipX'],
    [Math.PI / 2, { x: 100, y: 0 }, { x: 0, y: 100 }, 'flipY'],
    [Math.PI, { x: 200, y: 0 }, { x: 200, y: 0 }, 'flipX'],
    [Math.PI * 3 / 2, { x: -100, y: 0 }, { x: 0, y: 100 }, 'flipY']
  ]) {
    for (const nested of [false, true]) {
      const initial = seed(create('F', { shapeType: 'frame', rotation: nested ? rotation : 0 }), create('A', { shapeType: 'image', parentId: id('F'), rotation: nested ? 0 : rotation }))
      const result = run(initial, { type: 'scale_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, scale: { x: -2, y: 3 }, lockAspectRatio: false })
      const shape = result.snapshot.store[id('A')]
      point(shapeToPagePoint(result.snapshot, id('A'), { x: 0, y: 0 }), expected)
      point(shapeToPagePoint(result.snapshot, id('A'), localCorner), { x: 0, y: 0 })
      near(shape.rotation, nested ? 0 : rotation)
      assert.equal(shape.props[flip], true)
      assert.equal(shape.props[flip === 'flipX' ? 'flipY' : 'flipX'], false)
    }
  }
})

test('文字整体改字号倍率，横向边框改换行宽度；翻转后文字保持可读', () => {
  const initial = seed(create('A', { shapeType: 'text', x: 200, y: 150, text: 'One two three four five six seven eight nine', props: { w: 200, autoSize: true } }))
  const command = { type: 'scale_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 3 } }
  const scaled = run(initial, command).snapshot.store[id('A')]
  point(scaled, { x: 600, y: 450 })
  assert.equal(scaled.props.scale, 3)
  assert.equal(scaled.props.w, 200)
  assert.deepEqual(scaled.props.richText, initial.store[id('A')].props.richText)
  const width = run(initial, { ...command, scale: { x: 2, y: 1 }, mode: 'resize_bounds', handle: 'right' }).snapshot.store[id('A')]
  assert.equal(width.props.scale, 1)
  assert.equal(width.props.w, 400)
  assert.equal(width.props.autoSize, false)
  point(width, { x: 400, y: 150 })
  const unlocked = run(initial, { ...command, lockAspectRatio: false }).snapshot.store[id('A')]
  point(unlocked, { x: 400, y: 450 })
  assert.equal(unlocked.props.scale, 3)
  const flipped = run(initial, { ...command, scale: { x: -2, y: 2 } }).snapshot.store[id('A')]
  point(flipped, { x: -800, y: 300 })
  assert.equal(flipped.props.scale, 2)
  assert.equal(flipped.rotation, 0)
  assert.deepEqual(flipped.props.richText, initial.store[id('A')].props.richText)
})

test('画框只缩放边界，子孙记录不改；祖先子孙同选只处理最上层且 ID 去重', () => {
  const initial = seed(create('F', { shapeType: 'frame', x: 50, y: 50, props: { w: 400, h: 200 } }), create('A', { parentId: id('F'), x: 20, y: 30 }), create('G', { shapeType: 'frame', parentId: id('F') }), create('B', { parentId: id('G') }))
  for (const transform of [
    { type: 'scale_shapes', scale: { x: 2, y: 2 } },
    { type: 'rotate_shapes', angle: Math.PI / 2 }
  ]) {
    const result = run(initial, { ...transform, ids: [id('B'), id('F'), id('A'), id('F')], origin: { x: 0, y: 0 } })
    assert.deepEqual(Object.keys(result.changes.updated), [id('F')])
    assert.deepEqual(result.results, [{ shapeIds: [id('F')] }])
    for (const name of ['A', 'G', 'B']) assert.deepEqual(result.snapshot.store[id(name)], initial.store[id(name)])
  }
  const frame = run(initial, { type: 'scale_shapes', ids: [id('F')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 2 } }).snapshot.store[id('F')]
  point(frame, { x: 100, y: 100 })
  assert.equal(frame.props.w, 800)
  assert.equal(frame.props.h, 400)
})

test('锁定形状和锁定祖先下的目标不参与变换；全锁或空选择返回空变化', () => {
  const initial = run(seed(create('F', { shapeType: 'frame' }), create('A', { parentId: id('F') }), create('B'), create('C')), { type: 'toggle_lock', ids: [id('F'), id('B')] }).snapshot
  for (const transform of [{ type: 'rotate_shapes', angle: 0.4 }, { type: 'scale_shapes', scale: { x: -2, y: 3 } }]) {
    const command = { ...transform, origin: { x: 0, y: 0 } }
    const result = run(initial, { ...command, ids: [id('A'), id('B'), id('C')] })
    assert.deepEqual(result.results, [{ shapeIds: [id('C')] }])
    assert.deepEqual(result.snapshot.store[id('A')], initial.store[id('A')])
    assert.deepEqual(result.snapshot.store[id('B')], initial.store[id('B')])
    for (const ids of [[], [id('A'), id('B')]]) {
      const unchanged = run(initial, { ...command, ids })
      assert.deepEqual(unchanged.snapshot, initial)
      assert.deepEqual(unchanged.results, [{ shapeIds: [] }])
    }
  }
})

test('几何、图片和画框最小边长为 1，文字最小字号倍率 0.01，宽度最小为 1', () => {
  const initial = seed(...['geo', 'image', 'frame', 'text'].map(shapeType => create(shapeType, { shapeType, x: 200, y: 150, props: shapeType === 'text' ? { w: 200 } : { w: 200, h: 100 } })))
  const result = run(initial, { type: 'scale_shapes', ids: ['geo', 'image', 'frame', 'text'].map(id), origin: { x: 0, y: 0 }, scale: { x: 0.000001, y: 0.000001 } })
  for (const type of ['geo', 'image', 'frame']) {
    const shape = result.snapshot.store[id(type)]
    assert.equal(shape.props.w, 1)
    assert.equal(shape.props.h, 1)
    point(shape, { x: 0.0002, y: 0.00015 })
  }
  assert.equal(result.snapshot.store[id('text')].props.scale, 0.01)
  const width = run(initial, { type: 'scale_shapes', ids: [id('text')], origin: { x: 0, y: 0 }, scale: { x: -0.000001, y: 1 }, mode: 'resize_bounds', handle: 'left' }).snapshot.store[id('text')]
  assert.equal(width.props.w, 1)
  assert.equal(width.props.scale, 1)
})

test('旋转零度、整圈和倍率 1 不改任何记录；同批命令读取前序结果', () => {
  const initial = seed(create('A', { x: 10, y: 20, rotation: 0.37 }))
  for (const transform of [{ type: 'rotate_shapes', angle: 0 }, { type: 'rotate_shapes', angle: Math.PI * 2 }, { type: 'scale_shapes', scale: { x: 1, y: 1 } }]) {
    const result = run(initial, { ...transform, ids: [id('A')], origin: { x: 0, y: 0 } })
    assert.deepEqual(result.snapshot, initial)
    assert.deepEqual(result.changes, { added: {}, updated: {}, removed: {} })
    assert.deepEqual(result.results, [{ shapeIds: [] }])
  }
  const zero = seed(create('A', { x: 10, y: 20 }))
  const result = run(zero, { type: 'rotate_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, angle: Math.PI / 2 }, { type: 'scale_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 3 } })
  point(result.snapshot.store[id('A')], { x: -40, y: 30 })
  assert.equal(result.snapshot.store[id('A')].props.w, 300)
  assert.equal(result.snapshot.store[id('A')].props.h, 100)
})

test('零倍率、非法角度与原点、无效目标均原子拒绝，不影响前序输入', () => {
  const initial = seed(create('A'))
  const before = structuredClone(initial)
  const rotate = { type: 'rotate_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, angle: 0.5 }
  const scale = { type: 'scale_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 3 } }
  const invalid = [
    ...[0, -0, NaN, Infinity, '2', undefined].map(x => ({ ...scale, scale: { x, y: 1 } })),
    ...[NaN, Infinity, -Infinity, '1', null].map(angle => ({ ...rotate, angle })),
    ...[0, -1, Infinity, NaN, Math.PI * 3].map(step => ({ ...rotate, angle: undefined, step })),
    { ...rotate, step: 0.1 }, { ...rotate, angle: undefined },
    { ...rotate, angle: undefined, step: 0.1, direction: 0 },
    { ...rotate, angle: undefined, step: 0.1, referenceAngle: Infinity },
    { ...scale, lockAspectRatio: 1 }, { ...scale, mode: 'anything' }, { ...scale, handle: 'anything' },
    { ...scale, scale: { x: Number.MAX_VALUE, y: 2 } },
    ...[rotate, scale].flatMap(command => [
      { ...command, origin: undefined }, { ...command, origin: { x: 0, y: NaN } },
      { ...command, ids: [id('missing')] }, { ...command, ids: 'shape:A' },
      { ...command, ids: ['page:page'] }, { ...command, ids: [1] }
    ])
  ]
  for (const command of invalid) {
    assert.throws(() => run(initial, rotate, command), CanvasEditError, JSON.stringify(command))
    assert.deepEqual(initial, before)
  }
})

test('旋转、缩放与文字换行变化作为一个事务撤销，逐值恢复并可重做', () => {
  const initial = seed(create('F', { shapeType: 'frame', x: 120, y: 150, rotation: Math.PI / 6 }), create('A', { parentId: id('F'), x: 20, y: 30 }), create('B', { shapeType: 'text', x: 300, text: 'A long line 中文', props: { w: 100 } }), create('C', { shapeType: 'image' }))
  const transformed = run(initial,
    { type: 'rotate_shapes', ids: [id('A'), id('B')], origin: { x: 31, y: -19 }, angle: -0.3 },
    { type: 'scale_shapes', ids: [id('F'), id('A'), id('B'), id('C')], origin: { x: -23, y: 71 }, scale: { x: -1.1, y: 1.1 } },
    { type: 'scale_shapes', ids: [id('B')], origin: { x: 10, y: 20 }, scale: { x: 2, y: 1 }, mode: 'resize_bounds', handle: 'right' }
  )
  const history = recordCanvasTransaction(undefined, 'user', transformed.changes)
  const undone = undoCanvasTransaction(transformed.snapshot, history, 'user')
  assert.deepEqual(undone.snapshot, initial)
  assert.equal(undone.history.actors[0].undo.length, 0)
  const redone = redoCanvasTransaction(undone.snapshot, undone.history, 'user')
  assert.deepEqual(redone.snapshot, transformed.snapshot)
})

test('全部 20 种几何共用尺寸规则，标签增高并入新高度后不重复增长', () => {
  const kinds = ['rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'rhombus', 'rhombus-2', 'oval', 'trapezoid', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'x-box', 'check-box', 'cloud', 'heart']
  const initial = seed(...kinds.map(geo => create(geo, { x: 10, y: 20, props: { geo, w: 100, h: 50, growY: 20 } })))
  const result = run(initial, { type: 'scale_shapes', ids: kinds.map(id), origin: { x: 0, y: 0 }, scale: { x: 2, y: 3 } })
  for (const geo of kinds) {
    const shape = result.snapshot.store[id(geo)]
    point(shape, { x: 20, y: 60 })
    assert.equal(shape.props.geo, geo)
    assert.equal(shape.props.w, 200)
    assert.equal(shape.props.h, 210)
    assert.equal(shape.props.growY, 0)
    assert.deepEqual(getShapeBounds(shape), { x: 0, y: 0, w: 200, h: 210 })
  }
})

test('开发模式冻结的快照与命令可以变换，既有记录和命令均不被改写', () => {
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
    return value
  }
  const initial = freeze(seed(create('F', { shapeType: 'frame', rotation: 0.5 }), create('A', { parentId: id('F'), shapeType: 'image' })))
  const commands = freeze([{ type: 'rotate_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, step: Math.PI / 12 }, { type: 'scale_shapes', ids: [id('A')], origin: { x: 0, y: 0 }, scale: { x: -2, y: 3 } }])
  const original = structuredClone({ initial, commands })
  const result = executeCanvasCommands(initial, commands)
  assert.deepEqual({ initial, commands }, original)
  assert.deepEqual(Object.keys(result.changes.updated), [id('A')])
  assert.equal(result.snapshot.store[id('A')].props.flipX, true)
})

test('统一类型表保留拉伸的原有尺寸语义，图片不锁比例、文字仍排除', () => {
  const initial = seed(
    create('A', { x: 0, props: { w: 100, h: 50, growY: 20 } }),
    create('B', { x: 200, shapeType: 'image' }),
    create('F', { x: 400, shapeType: 'frame' }),
    create('T', { x: 1000, shapeType: 'text', text: '不参与拉伸', props: { w: 100 } }),
    create('child', { parentId: id('F'), x: 10, y: 20 })
  )
  const result = run(initial, { type: 'stretch_shapes', ids: ['A', 'B', 'F', 'T'].map(id), axis: 'x' })
  assert.deepEqual(result.results, [{ shapeIds: ['A', 'B', 'F'].map(id) }])
  for (const name of ['A', 'B', 'F']) {
    const shape = result.snapshot.store[id(name)]
    assert.equal(shape.props.w, 500)
    assert.equal(shape.props.h, 50)
    point(shape, { x: 0, y: 0 })
  }
  assert.equal(result.snapshot.store[id('A')].props.growY, 20)
  assert.equal(result.snapshot.store[id('B')].props.flipX, false)
  assert.deepEqual(result.snapshot.store[id('T')], initial.store[id('T')])
  assert.deepEqual(result.snapshot.store[id('child')], initial.store[id('child')])
})

test('组的整体变换留给 #75：组被跳过，子孙同选不单独改；单选组内形状仍可缩放', () => {
  const initial = seed(create('G', { shapeType: 'group', props: {}, x: 100, y: 200, rotation: Math.PI / 2 }), create('A', { parentId: id('G'), x: 10, y: 20 }), create('B', { x: 300, y: 400 }))
  const command = { type: 'scale_shapes', origin: { x: 0, y: 0 }, scale: { x: 2, y: 2 } }
  const skipped = run(initial, { ...command, ids: [id('G'), id('A')] })
  assert.deepEqual(skipped.snapshot, initial)
  assert.deepEqual(skipped.results, [{ shapeIds: [] }])
  const mixed = run(initial, { ...command, ids: [id('G'), id('A'), id('B')] })
  assert.deepEqual(mixed.results, [{ shapeIds: [id('B')] }])
  assert.deepEqual(mixed.snapshot.store[id('A')], initial.store[id('A')])
  const child = run(initial, { ...command, ids: [id('A')] })
  point(shapeToPagePoint(child.snapshot, id('A'), { x: 0, y: 0 }), { x: 160, y: 420 })
  assert.equal(child.snapshot.store[id('A')].props.w, 200)
})
