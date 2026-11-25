import { CanvasEditError } from '../errors.js'
import { layoutContext, placeLayoutShape, finishLayout, orderedLayoutItems, LAYOUT_EPSILON } from '../layout-context.js'
import { canLayoutResize, stretchLayoutShape, mirrorLayoutShape } from '../layout-resize.js'

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
    placeLayoutShape(context, item, axis === 'x' ? context.bounds.x : item.bounds.x, axis === 'y' ? context.bounds.y : item.bounds.y, next)
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
  // 按高度装入最合适的横排；同高用 ID 打破平局，结果不依赖选择顺序。
  const items = [...context.items].sort((a, b) => b.bounds.h - a.bounds.h || b.bounds.w - a.bounds.w || a.shape.id.localeCompare(b.shape.id))
  const width = Math.max(...items.map(item => item.bounds.w), Math.sqrt(items.reduce((sum, item) => sum + (item.bounds.w + gap) * (item.bounds.h + gap), 0)) - gap)
  const rows = []
  for (const item of items) {
    let row = rows.filter(row => row.used + item.bounds.w <= width + LAYOUT_EPSILON).sort((a, b) => b.used - a.used)[0]
    if (!row) {
      row = { y: rows.length ? rows.at(-1).y + rows.at(-1).height + gap : context.bounds.y, height: item.bounds.h, used: 0 }
      rows.push(row)
    }
    placeLayoutShape(context, item, context.bounds.x + row.used, row.y)
    row.used += item.bounds.w + gap
  }
  return finishLayout(context)
}

export function flipShapes(store, { ids, axis }) {
  const size = checkedAxis(axis), context = layoutContext(store, ids)
  for (const item of context.items) {
    const reflected = 2 * context.bounds[axis] + context.bounds[size] - item.bounds[axis] - item.bounds[size]
    placeLayoutShape(context, item, axis === 'x' ? reflected : item.bounds.x, axis === 'y' ? reflected : item.bounds.y, mirrorLayoutShape(context.records, item.shape, axis))
  }
  return finishLayout(context)
}
