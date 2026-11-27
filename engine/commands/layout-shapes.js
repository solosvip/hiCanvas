import { CanvasEditError } from '../errors.js'
import { layoutContext, placeLayoutShape, finishLayout, orderedLayoutItems, LAYOUT_EPSILON } from '../layout-context.js'
import { canLayoutResize, stretchLayoutShape, mirrorLayoutShape, pageRotation } from '../layout-resize.js'
import { transformTargets } from '../shape-transform.js'

function checkedAxis(axis) {
  if (axis !== 'x' && axis !== 'y') throw new CanvasEditError('排版方向需要是 x 或 y。')
  return axis === 'x' ? 'w' : 'h'
}

function checkedGap(gap) {
  if (!Number.isFinite(gap) || gap < 0) throw new CanvasEditError('形状间距需要是非负有限数值。')
  return gap
}

const alignments = Object.freeze({ left: ['x', 'w', 0], right: ['x', 'w', 1], top: ['y', 'h', 0], bottom: ['y', 'h', 1], 'center-horizontal': ['x', 'w', 0.5], 'center-vertical': ['y', 'h', 0.5] })

export function alignShapes(store, { ids, alignment }) {
  if (!Object.hasOwn(alignments, alignment)) throw new CanvasEditError('对齐方式无效。')
  const context = layoutContext(store, ids)
  if (context.items.length >= 2) {
    const [axis, size, fraction] = alignments[alignment]
    const target = context.bounds[axis] + context.bounds[size] * fraction
    for (const item of context.items) placeLayoutShape(context, item, axis === 'x' ? target - item.bounds.w * fraction : item.bounds.x, axis === 'y' ? target - item.bounds.h * fraction : item.bounds.y)
  }
  return finishLayout(context)
}

export function stretchShapes(store, { ids, axis }) {
  const size = checkedAxis(axis), context = layoutContext(store, ids, canLayoutResize)
  if (context.items.length >= 2) for (const item of context.items) {
    const factor = context.bounds[size] / item.bounds[size]
    const next = stretchLayoutShape(context.records, item, axis, Math.abs(factor - 1) < LAYOUT_EPSILON ? 1 : factor)
    if (!next) continue
    // 旧版四个合成样本对应回归关键词“旧版样本落点”（两横两竖，含负坐标）。
    // 组起点 = 选择最小值 + (选择长度 - 组长度) / 2，内容尺寸不变；
    // 例如 20…140 的组与 400…450 混选，组移到 175…295。
    const start = context.bounds[axis] + (item.shape.type === 'group' ? (context.bounds[size] - item.bounds[size]) / 2 : 0)
    placeLayoutShape(context, item, axis === 'x' ? start : item.bounds.x, axis === 'y' ? start : item.bounds.y, next)
  }
  return finishLayout(context)
}

function spaceShapes(store, { ids, axis }, gap) {
  const size = checkedAxis(axis), context = layoutContext(store, ids)
  if (context.items.length >= 3) {
    const items = orderedLayoutItems(context, axis)
    const first = items[0].bounds, last = items.at(-1).bounds
    const actualGap = gap ?? (last[axis] + last[size] - first[axis] - items.reduce((sum, item) => sum + item.bounds[size], 0)) / (items.length - 1)
    // 旧版在容不下形状时保持原样，避免负间距把空间顺序翻过来。
    if (actualGap < 0) return finishLayout(context)
    let cursor = first[axis]
    for (const item of items) {
      placeLayoutShape(context, item, axis === 'x' ? cursor : item.bounds.x, axis === 'y' ? cursor : item.bounds.y)
      cursor += item.bounds[size] + actualGap
    }
  }
  return finishLayout(context)
}

export const distributeShapes = (store, command) => spaceShapes(store, command)
export const stackShapes = (store, command) => spaceShapes(store, command, checkedGap(command.gap ?? 16))

export function packShapes(store, { ids, gap = 16 }) {
  checkedGap(gap)
  const context = layoutContext(store, ids)
  if (context.items.length < 2) return finishLayout(context)
  // 2026-11-26：隔离合成旧版、离屏原生右键→排列→紧凑排布，28组
  // before/after/undo/redo 读数；精确输入输出在 engine-pack.test.mjs。
  // ① A(100,100,100×80),B(330,190,80×120),C(620,360,60×40)
  //    → A(340,170),B(340,260),C(340,120)，gap=10。
  // ② 两个100×80位于(120,180)/(510,400) → (260,290)/(370,290)。
  // ③ 四个80×60分布在x=100/400、y=150/450 → x=115/205/295/385,y=300。
  // ④ 同样四项完全重叠(100,100) → x=100,y=-5/65/135/205。
  // ⑤ 原范围宽169时四个80×60排一列；宽170时两列，x=100/190,y=165/235。
  // 同尺寸反向选择反转排列，反向创建不改变；z=.5/2和尺寸翻倍仍间距10。
  // 高、宽升序稳定排序；较高项开新行，宽度受原选择范围约束；最后整体居中。
  const items = [...context.items].sort((a, b) => a.bounds.h - b.bounds.h || a.bounds.w - b.bounds.w)
  const positions = []
  let x = 0, y = 0, height = 0, width = 0
  for (const item of items) {
    if (x && (item.bounds.h > height || x + item.bounds.w > context.bounds.w + LAYOUT_EPSILON)) {
      y += height + gap; x = 0
    }
    height = item.bounds.h
    positions.push({ item, x, y })
    width = Math.max(width, x + item.bounds.w)
    x += item.bounds.w + gap
  }
  const left = context.bounds.x + (context.bounds.w - width) / 2
  const top = context.bounds.y + (context.bounds.h - y - height) / 2
  for (const position of positions) placeLayoutShape(context, position.item, left + position.x, top + position.y)
  return finishLayout(context)
}

export function flipShapes(store, { ids, axis }) {
  const size = checkedAxis(axis), { context } = transformTargets(store, ids, { expandGroups: true, includeGroupFrameContents: true })
  const placed = { ...context, records: { ...context.records } }
  for (const item of context.items) {
    const reflected = 2 * context.bounds[axis] + context.bounds[size] - item.bounds[axis] - item.bounds[size]
    const next = mirrorLayoutShape(context.records, item.shape, axis)
    // 父框先反射后，子形状要用新父链写回局部姿态；目标页面位置始终取原记录。
    next.rotation -= pageRotation(placed.records, item.shape) - pageRotation(context.records, item.shape)
    const count = placed.updates.length
    placeLayoutShape(placed, item, axis === 'x' ? reflected : item.bounds.x, axis === 'y' ? reflected : item.bounds.y, next)
    if (placed.updates.length > count) placed.records[item.shape.id] = placed.updates.at(-1)
  }
  return finishLayout(context)
}
