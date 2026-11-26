import '../tools/test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction, createEditorSession, CanvasEditError } from '../engine/index.js'
import { getShapePageBounds, shapeToPagePoint } from '../renderer/geometry.js'
import { memoryHost, snapshotOf } from './fixtures/editor-session-fixture.mjs'

const id = name => `shape:${name}`
const create = (name, fields = {}) => ({ type: 'create_shape', id: id(name), shapeType: 'geo', ...fields })
const seed = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
const run = (snapshot, ...commands) => executeCanvasCommands(snapshot, commands)
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} 应接近 ${expected}`)
const point = (actual, expected) => { near(actual.x, expected.x); near(actual.y, expected.y) }
const origin = { x: 13, y: -29 }

function reversible(before, result) {
  const history = recordCanvasTransaction(undefined, 'group-transform', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'group-transform')
  assert.deepEqual(undone.snapshot, before)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'group-transform').snapshot, result.snapshot)
}

function fixture(kind) {
  return seed([
    ...(kind === 'framed' ? [create('f', { shapeType: 'frame', x: 90, y: -40, rotation: 0.4 })] : []),
    create('g', { shapeType: 'group', parentId: kind === 'framed' ? id('f') : undefined, x: 80, y: 30, rotation: ['rotated', 'framed'].includes(kind) ? 0.3 : 0 }),
    ...(kind === 'nested' ? [create('h', { shapeType: 'group', parentId: id('g'), x: 20, y: -10, rotation: -0.2 })] : []),
    create('a', { parentId: kind === 'nested' ? id('h') : id('g'), x: 10, y: 20, rotation: 0.17, props: { w: 100, h: 60 } }),
    create('b', { parentId: kind === 'nested' ? id('h') : id('g'), shapeType: 'image', x: 200, y: 80, props: { w: 50, h: 40 } }),
    ...(kind === 'nested' ? [create('d', { parentId: id('g'), x: 320, props: { w: 40, h: 100 } })] : []),
    create('c', { x: 500, y: 100, props: { w: 50, h: 60 } }),
  ])
}

for (const kind of ['nested', 'rotated', 'framed']) for (const axis of ['x', 'y']) test(`${kind}：${axis} 镜像反射每个后代的页面朝向，两次镜像恢复全部值`, () => {
  const before = fixture(kind), selected = [id('g'), id('c'), id('a')]
  const command = { type: 'flip_shapes', ids: selected, axis }
  const result = run(before, command)
  const group = getShapePageBounds(before, id('g')), c = getShapePageBounds(before, id('c'))
  const size = axis === 'x' ? 'w' : 'h', other = axis === 'x' ? 'y' : 'x'
  const min = Math.min(group[axis], c[axis]), max = Math.max(group[axis] + group[size], c[axis] + c[size])
  for (const name of kind === 'nested' ? ['a', 'b', 'd', 'c'] : ['a', 'b', 'c']) {
    const a = getShapePageBounds(result.snapshot, id(name)), b = getShapePageBounds(before, id(name))
    near(a[axis], min + max - b[axis] - b[size])
    near(a[other], b[other])
    near(a.w, b.w); near(a.h, b.h)
    const from = shapeToPagePoint(before, id(name), { x: 0, y: 0 }), to = shapeToPagePoint(before, id(name), { x: 1, y: 0 })
    const nextFrom = shapeToPagePoint(result.snapshot, id(name), { x: 0, y: 0 }), nextTo = shapeToPagePoint(result.snapshot, id(name), { x: 1, y: 0 })
    near(nextTo.x - nextFrom.x, to.x - from.x)
    near(nextTo.y - nextFrom.y, -(to.y - from.y))
  }
  assert.equal(result.snapshot.store[id('b')].props[axis === 'x' ? 'flipX' : 'flipY'], true)
  const twice = run(result.snapshot, command).snapshot
  for (const [recordId, record] of Object.entries(before.store)) {
    const restored = twice.store[recordId]
    if (record.typeName !== 'shape') assert.deepEqual(restored, record)
    else {
      // 连续几何运算只容许 IEEE-754 舍入；撤销仍逐值深比较，不靠容差。
      for (const field of ['x', 'y', 'rotation']) near(restored[field], record[field])
      assert.deepEqual({ ...restored, x: 0, y: 0, rotation: 0 }, { ...record, x: 0, y: 0, rotation: 0 })
    }
  }
  reversible(before, result)
})

test('镜像组和普通形状混选时，组内左右次序也围绕共同外框翻转', () => {
  const before = seed([
    create('a', { x: 0, props: { w: 100, h: 60 } }),
    create('b', { x: 200, props: { w: 50, h: 40 } }),
    { type: 'group_shapes', ids: [id('a'), id('b')], groupId: id('g') },
    create('c', { x: 500, props: { w: 50, h: 60 } }),
  ])
  const result = run(before, { type: 'flip_shapes', ids: [id('g'), id('c')], axis: 'x' })
  assert.equal(getShapePageBounds(result.snapshot, id('a')).x, 450)
  assert.equal(getShapePageBounds(result.snapshot, id('b')).x, 300)
  assert.equal(getShapePageBounds(result.snapshot, id('c')).x, 0)
  reversible(before, result)
})

for (const kind of ['single', 'nested', 'rotated', 'framed', 'mixed']) {
  const selected = kind === 'mixed' ? [id('g'), id('c')] : [id('g')]
  const leaves = kind === 'nested' ? ['a', 'b', 'd'] : kind === 'mixed' ? ['a', 'b', 'c'] : ['a', 'b']
  test(`${kind}：组缩放带动后代，父链换算正确，重复父子选择不重复处理`, () => {
    const before = fixture(kind), original = structuredClone(before)
    const command = { type: 'scale_shapes', ids: [...selected, id('a'), id('g'), ...(kind === 'nested' ? [id('h')] : [])], origin, scale: { x: 2, y: 2 } }
    const result = run(before, command)
    for (const name of leaves) {
      const previous = shapeToPagePoint(before, id(name), { x: 0, y: 0 })
      point(shapeToPagePoint(result.snapshot, id(name), { x: 0, y: 0 }), { x: origin.x + 2 * (previous.x - origin.x), y: origin.y + 2 * (previous.y - origin.y) })
      const a = result.snapshot.store[id(name)], b = before.store[id(name)]
      near(a.props.w, b.props.w * 2)
      near(a.props.h, b.props.h * 2)
      assert.equal(a.rotation, b.rotation)
    }
    for (const name of ['g', 'h', 'f']) if (before.store[id(name)]) assert.deepEqual(result.snapshot.store[id(name)], before.store[id(name)])
    assert.deepEqual(result.results[0].shapeIds.sort(), leaves.map(id).sort())
    assert.deepEqual(before, original)
    reversible(before, result)
  })

  test(`${kind}：整组旋转保留后代局部记录，共用画布原点`, () => {
    const before = fixture(kind), angle = Math.PI / 4
    const result = run(before, { type: 'rotate_shapes', ids: [...selected, id('a')], origin, angle })
    for (const name of leaves) {
      const previous = shapeToPagePoint(before, id(name), { x: 0, y: 0 }), dx = previous.x - origin.x, dy = previous.y - origin.y
      point(shapeToPagePoint(result.snapshot, id(name), { x: 0, y: 0 }), { x: origin.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: origin.y + dx * Math.sin(angle) + dy * Math.cos(angle) })
      if (name !== 'c') assert.deepEqual(result.snapshot.store[id(name)], before.store[id(name)])
    }
    if (kind === 'nested') assert.deepEqual(result.snapshot.store[id('h')], before.store[id('h')])
    if (kind === 'framed') assert.deepEqual(result.snapshot.store[id('f')], before.store[id('f')])
    reversible(before, result)
  })
}

test('含图片组缩放仍按各自类型规则，混选普通形状不继承图片的锁比例', () => {
  const before = seed([
    create('g', { shapeType: 'group' }),
    create('a', { parentId: id('g'), props: { w: 100, h: 60 } }),
    create('b', { parentId: id('g'), x: 200, y: 80, shapeType: 'image', props: { w: 50, h: 40 } }),
    create('t', { parentId: id('g'), x: 300, shapeType: 'text', text: '合成文字' }),
    create('c', { x: 500, props: { w: 50, h: 60 } }),
  ])
  const command = { type: 'scale_shapes', ids: [id('g'), id('c')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 3 } }
  const result = run(before, command)
  const a = result.snapshot.store[id('a')], b = result.snapshot.store[id('b')], c = result.snapshot.store[id('c')]
  assert.deepEqual([a.props.w, a.props.h, b.x, b.y, b.props.w, b.props.h, c.x, c.props.w, c.props.h], [200, 180, 600, 240, 150, 120, 1000, 100, 180])
  assert.equal(result.snapshot.store[id('t')].props.scale, 3)
  const unlocked = run(before, { ...command, lockAspectRatio: false }).snapshot.store[id('b')]
  assert.deepEqual([unlocked.x, unlocked.y, unlocked.props.w, unlocked.props.h], [400, 240, 100, 120])
  reversible(before, result)
})

for (const sample of [
  { axis: 'x', g: [20, 30, 120, 80], c: [400, 10, 50, 30], expected: 175 },
  { axis: 'x', g: [-180, 60, 300, 100], c: [700, -90, 70, 50], expected: 145 },
  { axis: 'y', g: [40, -70, 100, 100], c: [-20, 400, 50, 40], expected: 135 },
  { axis: 'y', g: [70, 300, 150, 60], c: [100, -200, 30, 90], expected: 50 },
]) test(`组拉伸沿 ${sample.axis} 方向居中但不改内容，旧版样本落点 ${sample.expected}`, () => {
  const [x, y, w, h] = sample.g, [cx, cy, cw, ch] = sample.c
  const before = seed([
    create('a', { x, y, props: { w: w / 3, h: h / 2 } }),
    create('b', { x: x + w * 2 / 3, y: y + h / 2, props: { w: w / 3, h: h / 2 } }),
    { type: 'group_shapes', ids: [id('a'), id('b')], groupId: id('g') },
    create('c', { x: cx, y: cy, props: { w: cw, h: ch } }),
  ])
  const result = run(before, { type: 'stretch_shapes', ids: [id('g'), id('a'), id('c')], axis: sample.axis })
  const bounds = getShapePageBounds(result.snapshot, id('g'))
  near(bounds[sample.axis], sample.expected)
  point(bounds, sample.axis === 'x' ? { x: sample.expected, y } : { x, y: sample.expected })
  near(bounds.w, w); near(bounds.h, h)
  for (const name of ['a', 'b']) assert.deepEqual(result.snapshot.store[id(name)], before.store[id(name)])
  assert.deepEqual(result.snapshot.store[id('g')].props, {})
  reversible(before, result)
})

test('旋转组下一刻度使用组的页面朝向，不能因展开后代误当成多选', () => {
  const before = seed([
    create('f', { shapeType: 'frame', rotation: Math.PI / 2 }),
    create('g', { shapeType: 'group', parentId: id('f'), rotation: Math.PI / 36 }),
    create('a', { parentId: id('g') }), create('b', { parentId: id('g'), x: 200 }),
  ])
  const result = run(before, { type: 'rotate_shapes', ids: [id('g'), id('a')], origin, step: Math.PI / 12 })
  near(result.snapshot.store[id('g')].rotation, Math.PI / 12)
  assert.deepEqual(result.snapshot.store[id('a')], before.store[id('a')])
  reversible(before, result)
})

test('单组选中拉伸不动；非正交组只计入范围，文字仍排除', () => {
  const before = fixture('rotated')
  const alone = run(before, { type: 'stretch_shapes', ids: [id('g'), id('a')], axis: 'x' })
  assert.deepEqual(alone.snapshot, before)
  const text = run(before, create('t', { shapeType: 'text', text: '不参与拉伸', x: 5000 })).snapshot
  const result = run(text, { type: 'stretch_shapes', ids: [id('g'), id('c'), id('t')], axis: 'x' })
  for (const name of ['g', 'a', 'b', 't']) assert.deepEqual(result.snapshot.store[id(name)], text.store[id(name)])
  const bounds = getShapePageBounds(before, id('g'))
  near(result.snapshot.store[id('c')].x, bounds.x)
  near(result.snapshot.store[id('c')].props.w, 550 - bounds.x)
  reversible(text, result)
})

test('选中父组时内部锁定记录仍随整体运动，单独选锁定内容保持不动', () => {
  const before = run(fixture('single'), { type: 'update', id: id('a'), changes: { isLocked: true } }).snapshot
  const command = { type: 'scale_shapes', ids: [id('g')], origin, scale: { x: 2, y: 2 } }
  const result = run(before, command)
  assert.equal(result.snapshot.store[id('a')].props.w, 200)
  assert.equal(result.snapshot.store[id('a')].isLocked, true)
  assert.deepEqual(run(before, { ...command, ids: [id('a')] }).snapshot, before)
  reversible(before, result)
})

test('锁定目标与锁定祖先仍排除，选择父组时不绕过父级筛选', () => {
  const base = fixture('framed')
  for (const target of ['g', 'f']) {
    const before = run(base, { type: 'update', id: id(target), changes: { isLocked: true } }).snapshot
    for (const command of [
      { type: 'scale_shapes', origin, scale: { x: 2, y: 3 } },
      { type: 'rotate_shapes', origin, angle: 0.3 },
      { type: 'flip_shapes', axis: 'x' },
      { type: 'stretch_shapes', axis: 'x' },
    ]) {
      const result = run(before, { ...command, ids: [id('g'), id('a'), id('b')] })
      assert.deepEqual(result.snapshot, before)
      assert.deepEqual(result.results, [{ shapeIds: [] }])
    }
  }
})

test('组内画框缩放只改边界，画框后代仍由父级运动，不重复缩放', () => {
  const before = seed([
    create('g', { shapeType: 'group', x: 100, y: 200 }),
    create('f', { shapeType: 'frame', parentId: id('g'), x: 20, y: 30, props: { w: 100, h: 80 } }),
    create('child', { parentId: id('f'), x: 10, y: 20 }), create('a', { parentId: id('g'), x: 300 }),
  ])
  const result = run(before, { type: 'scale_shapes', ids: [id('g'), id('child'), id('f')], origin: { x: 0, y: 0 }, scale: { x: 2, y: 2 } })
  assert.deepEqual(result.snapshot.store[id('child')], before.store[id('child')])
  assert.equal(result.snapshot.store[id('f')].props.w, 200)
  assert.deepEqual(result.results[0].shapeIds.sort(), [id('a'), id('f')])
  reversible(before, result)
})

for (const axis of ['x', 'y']) test(`组沿 ${axis} 镜像穿过画框反射全部后代，越界内容不使两次镜像中心漂移`, () => {
  const before = seed([
    create('g', { shapeType: 'group' }),
    create('f', { shapeType: 'frame', parentId: id('g'), x: 20, y: 30, rotation: 0.2, props: { w: 100, h: 80 } }),
    create('a', { parentId: id('f'), x: 200, y: 20, rotation: 0.17, props: { w: 100, h: 20 } }),
    create('inner', { shapeType: 'group', parentId: id('f'), x: 10, y: 20, rotation: -0.3 }),
    create('image', { shapeType: 'image', parentId: id('inner'), x: 20, y: 30, rotation: 0.1, props: { w: 60, h: 40 } }),
    create('other', { parentId: id('inner'), x: 200, props: { w: 20, h: 30 } }),
    create('b', { parentId: id('g'), x: 400, props: { w: 100, h: 60 } }),
  ])
  const command = { type: 'flip_shapes', ids: [id('g'), id('f'), id('a')], axis }
  const result = run(before, command), box = getShapePageBounds(before, id('g'))
  const a0 = shapeToPagePoint(result.snapshot, id('a'), { x: 0, y: 0 }), a1 = shapeToPagePoint(result.snapshot, id('a'), { x: 1, y: 0 })
  near(Math.atan2(a1.y - a0.y, a1.x - a0.x), -0.37)
  const size = axis === 'x' ? 'w' : 'h', other = axis === 'x' ? 'y' : 'x'
  for (const name of ['f', 'a', 'b', 'image', 'other']) {
    const from = getShapePageBounds(before, id(name)), to = getShapePageBounds(result.snapshot, id(name))
    near(to[axis], box[axis] * 2 + box[size] - from[axis] - from[size])
    near(to[other], from[other])
  }
  assert.equal(result.snapshot.store[id('image')].props[axis === 'x' ? 'flipX' : 'flipY'], true)
  const twice = run(result.snapshot, command).snapshot
  for (const name of ['g', 'f', 'a', 'b', 'inner', 'image', 'other']) {
    const a = twice.store[id(name)], b = before.store[id(name)]
    for (const field of ['x', 'y', 'rotation']) near(a[field], b[field])
    assert.deepEqual({ ...a, x: 0, y: 0, rotation: 0 }, { ...b, x: 0, y: 0, rotation: 0 })
  }
  reversible(before, result)
})

test('组变换整批读取前序结果，撤销逐值恢复；后续非法命令不泄漏半次写入', async t => {
  const before = fixture('nested'), original = structuredClone(before)
  const commands = [
    { type: 'rotate_shapes', ids: [id('g')], origin, angle: 0.4 },
    { type: 'scale_shapes', ids: [id('g'), id('c')], origin, scale: { x: -2, y: 3 }, lockAspectRatio: false },
  ]
  const result = run(before, ...commands)
  reversible(before, result)
  assert.throws(() => run(before, ...commands, { type: 'scale_shapes', ids: [id('g')], origin, scale: { x: 0, y: 1 } }), CanvasEditError)
  assert.deepEqual(before, original)
  const host = memoryHost(before), session = await createEditorSession({ transport: host.transport, actor: 'group-transform' })
  t.after(() => session.dispose())
  session.beginGesture()
  session.preview(commands)
  assert.deepEqual(snapshotOf(session), result.snapshot)
  assert.throws(() => session.preview([{ type: 'scale_shapes', ids: [id('g')], origin, scale: { x: Number.MAX_VALUE, y: 2 } }]), CanvasEditError)
  assert.deepEqual(snapshotOf(session), result.snapshot)
  await session.commitGesture()
  assert.equal(host.commits.length, 1)
  assert.deepEqual(host.current().snapshot, result.snapshot)
})
