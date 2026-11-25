import { CanvasEditError } from '../errors.js'

export function putRecord(store, { record }) {
  if (!record || typeof record.id !== 'string' || !store.scopedTypes.document.has(record.typeName)) throw new CanvasEditError('只允许写入有效的画板文档记录。')
  store.put([record])
}
