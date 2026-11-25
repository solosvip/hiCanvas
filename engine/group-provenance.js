const key = 'hicanvasGrouping'

// 浮点减法再加法不保证逐值还原。只记同父组合的原坐标与层级，
// 解组时确认平移关系仍匹配才恢复；移动/旋转后的组仍使用当前几何计算。
export function rememberGrouping(group, shapes) {
  return { ...group.meta, [key]: {
    parentId: group.parentId, x: group.x, y: group.y, index: group.index,
    children: Object.fromEntries(shapes.map(shape => [shape.id, { x: shape.x, y: shape.y, index: shape.index }])),
  } }
}

export function restoreGrouping(group, children) {
  const source = group.meta[key]
  const sameParent = source?.parentId === group.parentId
  const preserveIndices = sameParent && source.index === group.index && children.every(child => source.children?.[child.id]?.index === child.index)
  const positions = new Map()
  if (sameParent && source.x === group.x && source.y === group.y && group.rotation === 0) for (const child of children) {
    const original = source.children?.[child.id], point = {}
    for (const axis of ['x', 'y']) if (Number.isFinite(original?.[axis]) && original[axis] - group[axis] === child[axis]) point[axis] = original[axis]
    positions.set(child.id, point)
  }
  return { preserveIndices, positions }
}
