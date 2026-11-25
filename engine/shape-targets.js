import { CanvasEditError } from './errors.js'

// 命令使用显式 ID 列表；去重后同一形状只处理一次，不读取交互选择状态。
export function getTargetShapes(store, ids) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new CanvasEditError('需要形状 ID 列表。')
  return [...new Set(ids)].map(id => {
    const record = store.get(id)
    if (record?.typeName !== 'shape') throw new CanvasEditError(`找不到形状：${id}`)
    return record
  })
}
