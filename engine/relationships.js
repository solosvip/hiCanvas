import { CanvasEditError } from './errors.js'

// schema 校验单条记录；这里验证一批命令完成后的跨记录关系。
export function validateRelationships(store, pageId) {
  const records = store.allRecords()
  const pages = records.filter(record => record.typeName === 'page')
  if (pages.length !== 1 || pages[0].id !== pageId) throw new CanvasEditError('不能新增、替换或删除内部画布。')
  for (const record of records) {
    if (record.typeName === 'shape') {
      let parent = store.get(record.parentId)
      const visited = new Set([record.id])
      while (parent?.typeName === 'shape') {
        if (visited.has(parent.id)) throw new CanvasEditError('形状的父子关系形成循环。')
        visited.add(parent.id)
        parent = store.get(parent.parentId)
      }
      if (parent?.typeName !== 'page') throw new CanvasEditError('形状必须属于有效画布或父形状。')
      if (record.type === 'image' && record.props.assetId && !store.has(record.props.assetId)) throw new CanvasEditError('图片引用的资源不存在。')
    }
    if (record.typeName === 'binding' && (!store.has(record.fromId) || !store.has(record.toId))) throw new CanvasEditError('连接绑定引用的形状不存在。')
  }
}
