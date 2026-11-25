import { b64Vecs } from '@tldraw/tlschema'
import { getIndexAbove, sortByIndex } from '@tldraw/utils'
import { httpError } from './file-lock.mjs'

export function singlePageId(snapshot) {
  const pages = Object.values(snapshot.store).filter(r => r.typeName === 'page')
  if (pages.length !== 1) throw httpError('每个画板只允许一张无限画布，不能新建或删除内部页面。')
  return pages[0].id
}

// 迁移只平移旧页的顶层形状，子形状、绑定、资源及旋转保持原样。
// 使用保守包围范围，包含嵌套旋转、自由笔迹和向负坐标延伸的内容。
function boundsFor(store, pageId) {
  let left = Infinity, right = -Infinity
  const transforms = new Map()
  function transform(shape) {
    if (transforms.has(shape.id)) return transforms.get(shape.id)
    const parent = store[shape.parentId]
    const base = parent?.typeName === 'shape' ? transform(parent) : { x: 0, y: 0, r: 0, page: parent?.id }
    const result = {
      x: base.x + Math.cos(base.r) * shape.x - Math.sin(base.r) * shape.y,
      y: base.y + Math.sin(base.r) * shape.x + Math.cos(base.r) * shape.y,
      r: base.r + shape.rotation, page: base.page
    }
    transforms.set(shape.id, result)
    return result
  }
  for (const shape of Object.values(store)) {
    if (shape.typeName !== 'shape') continue
    const position = transform(shape)
    if (position.page !== pageId) continue
    const props = shape.props || {}, scale = props.scale || 1
    const text = props.richText ? JSON.stringify(props.richText) : ''
    const w = props.w ?? (shape.type === 'note' ? 200 : shape.type === 'text' ? text.length * 48 : 0)
    const h = (props.h ?? (shape.type === 'note' ? 200 : shape.type === 'text' ? text.length * 64 : 0)) + (props.growY || 0)
    const strokePoints = (props.segments || []).flatMap(s => (s.path ? b64Vecs.decodePoints(s.path) : s.points || []).map(p => ({ x: p.x * (props.scaleX ?? 1), y: p.y * (props.scaleY ?? 1) })))
    const points = [{ x: 0, y: 0 }, { x: w * scale, y: 0 }, { x: 0, y: h * scale }, { x: w * scale, y: h * scale }, props.start, props.end, ...Object.values(props.points || {}),
      ...strokePoints].filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    // 曲线控制柄可能越过采样点，额外保留点集跨度，避免旧页合并后盖住邻区。
    const curvePadding = props.spline === 'cubic' ? points.reduce((max, p) => Math.max(max, Math.hypot(p.x, p.y)), 0) : 0
    for (const point of points) {
      const x = position.x + Math.cos(position.r) * point.x - Math.sin(position.r) * point.y
      const padding = Math.abs(props.bend || 0) + curvePadding + 64 * Math.max(1, Math.abs(scale))
      left = Math.min(left, x - padding); right = Math.max(right, x + padding)
    }
  }
  return Number.isFinite(left) ? { left, right } : { left: 0, right: 0 }
}

export function mergeLegacyPages(snapshot) {
  const store = snapshot.store
  const pages = Object.values(store).filter(r => r.typeName === 'page').sort(sortByIndex)
  if (pages.length <= 1) return null
  const pageId = pages[0].id, offsets = {}
  let right = boundsFor(store, pageId).right
  let index = Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === pageId).sort(sortByIndex).at(-1)?.index || 'a0'
  for (const page of pages.slice(1)) {
    const bounds = boundsFor(store, page.id)
    const dx = right + 240 - bounds.left
    offsets[page.id] = { x: dx, y: 0, name: page.name }
    for (const shape of Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === page.id).sort(sortByIndex)) {
      shape.parentId = pageId
      shape.x += dx
      shape.index = index = getIndexAbove(index)
    }
    right = bounds.right + dx
    delete store[page.id]
  }
  return { pageId, offsets }
}

export function restoreSingleCanvasView(value, migration) {
  const offset = migration?.offsets[value?.currentPageId]
  if (!offset) return value
  return { ...value, currentPageId: migration.pageId, ...(value.camera && { camera: { ...value.camera, x: value.camera.x - offset.x, y: value.camera.y - offset.y } }) }
}
