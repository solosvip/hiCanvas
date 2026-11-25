import { getIndicesBetween, sortByIndex } from '@tldraw/utils'

// 只计算直接子形状移到上层父容器的改动；保留原画布位置、旋转与层次。
// #31 占位框替换和移除画框共享此计算，不修改传入记录。
export function reparentChildren(records, frame) {
  const children = records.filter(record => record.typeName === 'shape' && record.parentId === frame.id).sort(sortByIndex)
  const above = records.filter(record => record.typeName === 'shape' && record.parentId === frame.parentId && record.index > frame.index).map(record => record.index).sort()[0]
  const indices = getIndicesBetween(frame.index, above, children.length)
  return children.map((child, i) => ({
    id: child.id,
    changes: {
      index: indices[i], parentId: frame.parentId,
      x: frame.x + Math.cos(frame.rotation) * child.x - Math.sin(frame.rotation) * child.y,
      y: frame.y + Math.sin(frame.rotation) * child.x + Math.cos(frame.rotation) * child.y,
      rotation: child.rotation + frame.rotation,
    },
  }))
}
