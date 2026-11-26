import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction } from '../engine/index.js'
import { getShapePageBounds } from '../renderer/geometry.js'

const id = name => `shape:${name}`
const run = (snapshot, command) => executeCanvasCommands(snapshot, [command])
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`)
const bounds = (snapshot, name) => getShapePageBounds(snapshot, id(name))
const shape = (name, extra = {}) => ({ type: 'create_shape', id: id(name), shapeType: 'geo', props: { w: 40, h: 30 }, ...extra })

function seed(rotation = 0, parentRotation = 0) {
  return executeCanvasCommands(createCanvasSnapshot(), [
    shape('parent', { shapeType: 'frame', x: 300.25, y: -180.75, rotation: parentRotation }),
    shape('A', { x: 10.25, y: 20.125, rotation }),
    shape('B', { parentId: id('parent'), x: 80.375, y: 90.625, rotation: rotation ? -rotation / 2 : 0, props: { w: 60, h: 25 } }),
    shape('C', { x: 600.875, y: 200.375, rotation: rotation / 3, props: { w: 30, h: 55 } }),
  ]).snapshot
}

const selected = ['A', 'B', 'C'].map(id)
const cases = [
  ...['left', 'right', 'top', 'bottom', 'center-horizontal', 'center-vertical'].map(alignment => ({ type: 'align_shapes', alignment })),
  ...['x', 'y'].flatMap(axis => ['stretch_shapes', 'distribute_shapes', 'stack_shapes', 'flip_shapes'].map(type => ({ type, axis, ...(type === 'stack_shapes' ? { gap: 12.5 } : {}) }))),
  { type: 'pack_shapes', gap: 12.5 },
]

for (const [rotation, parentRotation] of [[0, 0], [0.37, 0], [0.37, Math.PI / 3], [0, Math.PI / 2]]) {
  for (const command of cases) test(`${command.type} ${command.alignment || command.axis || ''}：形状旋转 ${rotation}，父容器旋转 ${parentRotation}`, () => {
    const initial = seed(rotation, parentRotation), original = structuredClone(initial)
    const result = run(initial, { ...command, ids: selected })
    const before = selected.map(recordId => getShapePageBounds(initial, recordId))
    const after = selected.map(recordId => getShapePageBounds(result.snapshot, recordId))
    const minX = Math.min(...before.map(b => b.x)), maxX = Math.max(...before.map(b => b.x + b.w))
    const minY = Math.min(...before.map(b => b.y)), maxY = Math.max(...before.map(b => b.y + b.h))
    if (command.type === 'align_shapes') {
      const { alignment } = command
      const axis = ['left', 'right', 'center-horizontal'].includes(alignment) ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h'
      const fraction = ['right', 'bottom'].includes(alignment) ? 1 : alignment.startsWith('center') ? 0.5 : 0
      const min = axis === 'x' ? minX : minY, max = axis === 'x' ? maxX : maxY
      after.forEach((b, i) => { close(b[axis] + b[size] * fraction, min + (max - min) * fraction); close(b[axis === 'x' ? 'y' : 'x'], before[i][axis === 'x' ? 'y' : 'x']) })
    } else if (command.type === 'stretch_shapes') {
      const axis = command.axis, size = axis === 'x' ? 'w' : 'h', min = axis === 'x' ? minX : minY, max = axis === 'x' ? maxX : maxY
      after.forEach((b, i) => {
        const shape = initial.store[selected[i]], angle = shape.rotation + (shape.parentId === id('parent') ? parentRotation : 0)
        if (Math.abs(Math.sin(angle)) < 1e-9 || Math.abs(Math.cos(angle)) < 1e-9) { close(b[axis], min); close(b[size], max - min) }
        else assert.deepEqual(result.snapshot.store[selected[i]], shape)
      })
    } else if (['distribute_shapes', 'stack_shapes'].includes(command.type)) {
      const axis = command.axis, size = axis === 'x' ? 'w' : 'h'
      const ordered = before.map((b, i) => ({ b, i })).sort((a, b) => a.b[axis] - b.b[axis])
      const gap = (index) => { const a = after[ordered[index - 1].i], b = after[ordered[index].i]; return b[axis] - a[axis] - a[size] }
      close(gap(1), gap(2))
      if (command.type === 'stack_shapes') {
        close(gap(1), 12.5)
        after.forEach((b, i) => close(b[axis === 'x' ? 'y' : 'x'], before[i][axis === 'x' ? 'y' : 'x']))
      }
      else { close(after[ordered[0].i][axis], before[ordered[0].i][axis]); close(after[ordered[2].i][axis] + after[ordered[2].i][size], before[ordered[2].i][axis] + before[ordered[2].i][size]) }
    } else if (command.type === 'flip_shapes') {
      after.forEach((b, i) => {
        const axis = command.axis, size = axis === 'x' ? 'w' : 'h', min = axis === 'x' ? minX : minY, max = axis === 'x' ? maxX : maxY
        close(b[axis], min + max - before[i][axis] - before[i][size])
        close(b[size], before[i][size])
        close(b[axis === 'x' ? 'y' : 'x'], before[i][axis === 'x' ? 'y' : 'x'])
      })
    } else {
      for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) {
        const a = after[i], b = after[j]
        assert.ok(a.x + a.w + 12.5 <= b.x + 1e-8 || b.x + b.w + 12.5 <= a.x + 1e-8 || a.y + a.h + 12.5 <= b.y + 1e-8 || b.y + b.h + 12.5 <= a.y + 1e-8)
      }
    }
    assert.deepEqual(result.results[0].shapeIds.sort(), Object.keys(result.changes.updated).sort())
    assert.deepEqual(initial, original)
    if (Object.keys(result.changes.updated).length) {
      const history = recordCanvasTransaction(undefined, 'layout', result.changes)
      assert.deepEqual(undoCanvasTransaction(result.snapshot, history, 'layout').snapshot, initial)
    } else assert.deepEqual(result.snapshot, initial)
  })
}

test('锁定形状及锁定祖先下的子形状不参与，祖先子孙同选只处理最上层', () => {
  const initial = executeCanvasCommands(seed(), [shape('child', { parentId: id('parent'), x: 9, y: 11 }), { type: 'update', id: id('A'), changes: { isLocked: true } }]).snapshot
  for (const command of cases) {
    const result = run(initial, { ...command, ids: [...selected, id('parent'), id('child'), id('child')] })
    assert.deepEqual(result.snapshot.store[id('A')], initial.store[id('A')])
    assert.deepEqual(result.snapshot.store[id('child')], initial.store[id('child')])
    assert.deepEqual(result.snapshot.store[id('B')], initial.store[id('B')])
  }
  const locked = run(initial, { type: 'update', id: id('parent'), changes: { isLocked: true } }).snapshot
  const result = run(locked, { type: 'align_shapes', ids: selected, alignment: 'left' })
  assert.deepEqual(result.snapshot.store[id('B')], locked.store[id('B')])
})

test('数量不足、空选择不改数据；未知目标和参数错误整批拒绝', () => {
  const initial = seed()
  for (const command of cases) for (const ids of [[], command.type === 'flip_shapes' ? [] : [id('A')]]) {
    const result = run(initial, { ...command, ids })
    assert.deepEqual(result.snapshot, initial)
    assert.deepEqual(result.results, [{ shapeIds: [] }])
  }
  for (const command of cases.filter(c => ['distribute_shapes', 'stack_shapes'].includes(c.type))) assert.deepEqual(run(initial, { ...command, ids: selected.slice(0, 2) }).snapshot, initial)
  for (const bad of [{ type: 'align_shapes', alignment: 'bogus' }, { type: 'flip_shapes', axis: 'z' }, { type: 'stretch_shapes', axis: 'z' }, { type: 'distribute_shapes', axis: 'z' }, { type: 'stack_shapes', axis: 'x', gap: -1 }, { type: 'pack_shapes', gap: Infinity }]) assert.throws(() => run(initial, { ...bad, ids: selected }))
  assert.throws(() => run(initial, { type: 'align_shapes', alignment: 'left', ids: [id('missing')] }))
})

test('文字与未登记外框的形状不拉伸；仅一个可改尺寸目标不发生变化', () => {
  const initial = executeCanvasCommands(seed(), [shape('text', { shapeType: 'text', x: -500, text: '保持可读', props: { w: 140 } }), shape('arrow', { shapeType: 'arrow', props: {} })]).snapshot
  for (const axis of ['x', 'y']) {
    const onlyOne = run(initial, { type: 'stretch_shapes', axis, ids: ['A', 'text', 'arrow'].map(id) })
    assert.deepEqual(onlyOne.snapshot, initial)
    const result = run(initial, { type: 'stretch_shapes', axis, ids: [...selected, id('text'), id('arrow')] })
    assert.deepEqual(result.snapshot.store[id('text')], initial.store[id('text')])
    assert.deepEqual(result.snapshot.store[id('arrow')], initial.store[id('arrow')])
    const range = selected.map(recordId => getShapePageBounds(initial, recordId))
    const start = Math.min(...range.map(b => b[axis])), size = axis === 'x' ? 'w' : 'h'
    const end = Math.max(...range.map(b => b[axis] + b[size]))
    for (const recordId of selected) { const b = getShapePageBounds(result.snapshot, recordId); close(b[axis], start); close(b[size], end - start) }
  }
})

test('椭圆、图片、画框的正交拉伸精确铺满，非正交保持原样但计入范围', () => {
  for (const shapeType of ['geo', 'image', 'frame']) for (const angle of [0, Math.PI / 2, -0.63]) for (const axis of ['x', 'y']) {
    const initial = executeCanvasCommands(createCanvasSnapshot(), [
      shape('A', { shapeType, x: 20.25, y: 40.75, rotation: angle, props: { w: 60.5, h: 40.25, ...(shapeType === 'geo' ? { geo: 'ellipse' } : {}) } }),
      shape('B', { shapeType, x: 250.125, y: 180.375, props: { w: 90.25, h: 50.5 } }),
    ]).snapshot
    const result = run(initial, { type: 'stretch_shapes', axis, ids: ['A', 'B'].map(id) })
    const a = bounds(result.snapshot, 'A'), b = bounds(result.snapshot, 'B'), size = axis === 'x' ? 'w' : 'h'
    const before = ['A', 'B'].map(name => bounds(initial, name)), min = Math.min(...before.map(b => b[axis])), max = Math.max(...before.map(b => b[axis] + b[size]))
    close(b[axis], min); close(b[size], max - min)
    if (angle === -0.63) assert.deepEqual(result.snapshot.store[id('A')], initial.store[id('A')])
    else { close(a[axis], min); close(a[size], max - min) }
    assert.equal(result.snapshot.store[id('A')].rotation, angle)
    if (angle === 0 || angle === Math.PI / 2) {
      const preserved = (angle === 0) === (axis === 'x') ? 'h' : 'w'
      assert.equal(result.snapshot.store[id('A')].props[preserved], initial.store[id('A')].props[preserved])
    }
  }
})

test('45度形状保留原样但计入最少数量和外框，抵消父旋转后按画布朝向判断', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [
    shape('parent', { shapeType: 'frame', rotation: Math.PI / 4 }),
    shape('A', { x: -200.25, y: 20.125, rotation: Math.PI / 4 }),
    shape('B', { parentId: id('parent'), x: 50.5, y: 60.25, rotation: -Math.PI / 4 }),
  ]).snapshot
  for (const axis of ['x', 'y']) {
    const result = run(initial, { type: 'stretch_shapes', axis, ids: ['A', 'B'].map(id) })
    assert.deepEqual(result.snapshot.store[id('A')], initial.store[id('A')])
    assert.deepEqual(result.results[0].shapeIds, [id('B')])
    const a = bounds(initial, 'A'), b = bounds(initial, 'B'), actual = bounds(result.snapshot, 'B'), size = axis === 'x' ? 'w' : 'h'
    close(actual[axis], Math.min(a[axis], b[axis])); close(actual[axis] + actual[size], Math.max(a[axis] + a[size], b[axis] + b[size]))
  }
})

test('图片翻转切换像素方向，文字保持可读；双次镜像逐值恢复到浮点精度', () => {
  const initial = executeCanvasCommands(seed(0.37, 0.81), [shape('image', { shapeType: 'image', parentId: id('parent'), x: 13.125, y: 80.625, rotation: 0.27 }), shape('text', { shapeType: 'text', x: 200.5, y: 120.25, rotation: 0.23, text: 'ABC 中文', props: { w: 140 } })]).snapshot
  const ids = [...selected, id('image'), id('text')]
  for (const axis of ['x', 'y']) {
    const once = run(initial, { type: 'flip_shapes', axis, ids }).snapshot
    assert.equal(once.store[id('image')].props[axis === 'x' ? 'flipX' : 'flipY'], true)
    assert.deepEqual(once.store[id('text')].props, initial.store[id('text')].props)
    close(once.store[id('image')].rotation + 0.81, -(initial.store[id('image')].rotation + 0.81))
    const twice = run(once, { type: 'flip_shapes', axis, ids }).snapshot
    for (const recordId of ids) {
      const actual = twice.store[recordId], expected = initial.store[recordId]
      for (const key of ['x', 'y', 'rotation']) close(actual[key], expected[key])
      assert.deepEqual(actual.props, expected.props)
    }
  }
})

test('紧凑排布确定落点、间隔与选择顺序无关；已对齐只返回实际变化', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [shape('A', { x: 10.25, y: 20.125 }), shape('B', { x: 100, y: 80 }), shape('C', { x: 180, y: 140 })]).snapshot
  const command = { type: 'pack_shapes', gap: 10, ids: selected }
  const result = run(initial, command)
  close(bounds(result.snapshot, 'A').x, 10.25); close(bounds(result.snapshot, 'A').y, 20.125)
  close(bounds(result.snapshot, 'B').x, 10.25); close(bounds(result.snapshot, 'B').y, 60.125)
  close(bounds(result.snapshot, 'C').x, 10.25); close(bounds(result.snapshot, 'C').y, 100.125)
  assert.deepEqual(run(initial, { ...command, ids: [...selected].reverse() }).snapshot, result.snapshot)
  const aligned = run(initial, { type: 'align_shapes', ids: selected, alignment: 'left' })
  assert.deepEqual(aligned.results, [{ shapeIds: [id('B'), id('C')] }])
  const repeat = run(aligned.snapshot, { type: 'align_shapes', ids: selected, alignment: 'left' })
  assert.deepEqual(repeat.results, [{ shapeIds: [] }])
  assert.deepEqual(repeat.changes.updated, {})
})

test('同批前序命令已改变外框时排版读取当前值，后序失败整次不污染输入', () => {
  const initial = seed(), original = structuredClone(initial)
  const commands = [{ type: 'update', id: id('A'), changes: { x: -80.125 } }, { type: 'align_shapes', alignment: 'left', ids: selected }]
  const result = executeCanvasCommands(initial, commands)
  selected.forEach(recordId => close(getShapePageBounds(result.snapshot, recordId).x, -80.125))
  assert.throws(() => executeCanvasCommands(initial, [...commands, { type: 'stack_shapes', ids: selected, axis: 'x', gap: -1 }]))
  assert.deepEqual(initial, original)
})

test('宽形状包住其他形状、需负间距才能分布时整条不改，保留空间顺序', () => {
  for (const axis of ['x', 'y']) {
    const initial = executeCanvasCommands(createCanvasSnapshot(), [['A', 0, 1000], ['B', 100, 20], ['C', 200, 20]].map(([name, offset, extent]) => shape(name, { [axis]: offset, props: { w: axis === 'x' ? extent : 40, h: axis === 'y' ? extent : 40 } }))).snapshot
    const result = run(initial, { type: 'distribute_shapes', axis, ids: selected })
    assert.deepEqual(result.snapshot, initial)
    assert.deepEqual(result.results, [{ shapeIds: [] }])
    assert.deepEqual(result.changes.updated, {})
  }
})
