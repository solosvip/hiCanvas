import { CanvasEditError } from './errors.js'

// records 是只读的 ID → 记录映射，结果从最近的父形状向画布排列。
export function getShapeAncestors(records, parentId) {
  const ancestors = []
  const visited = new Set()
  let parent = records[parentId]
  while (parent?.typeName === 'shape') {
    if (visited.has(parent.id)) throw new CanvasEditError('形状的父子关系形成循环。')
    visited.add(parent.id)
    ancestors.push(parent)
    parent = records[parent.parentId]
  }
  if (parent?.typeName !== 'page') throw new CanvasEditError('找不到形状所属画布或父形状。')
  return ancestors
}

// 位移向量只受父链旋转影响，父容器的平移与形状自身的旋转不参与换算。
// 保持纯数据接口，供微移以及后续复制、对齐命令复用。
export function pageDeltaToParentDelta(records, parentId, delta) {
  if (!delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new CanvasEditError('画布位移需要有限的 x、y 数值。')
  const rotation = getShapeAncestors(records, parentId).reduce((sum, parent) => sum + parent.rotation, 0)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: delta.x * cos + delta.y * sin, y: -delta.x * sin + delta.y * cos }
}
