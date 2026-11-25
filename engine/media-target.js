import { CanvasEditError } from './errors.js'

export function pageFor(records, shape) {
  const visited = new Set()
  while (shape?.typeName === 'shape' && !visited.has(shape.id)) { visited.add(shape.id); shape = records[shape.parentId] }
  return shape?.typeName === 'page' ? shape.id : null
}

// 宿主可在保存文件前做同一份只读校验；命令执行时仍重新校验目标。
export function getMediaTarget(snapshot, args) {
  const records = snapshot.store
  const id = args.draftShapeId || args.anchorShapeId
  const anchor = id ? records[id] : null
  if (id && anchor?.typeName !== 'shape') throw new CanvasEditError('目标框已被删除；结果未插入其他位置。', 'conflict')
  const pageId = args.pageId || pageFor(records, anchor) || Object.values(records).find(record => record.typeName === 'page')?.id
  if (records[pageId]?.typeName !== 'page' || (anchor && pageFor(records, anchor) !== pageId)) throw new CanvasEditError('目标画布无效或与选中对象不一致。')
  return { anchor, pageId }
}
