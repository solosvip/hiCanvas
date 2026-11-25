import { CanvasEditError } from '../errors.js'

export function updateRecord(store, { id, changes }) {
  const previous = store.get(id)
  if (!previous || !store.scopedTypes.document.has(previous.typeName)) throw new CanvasEditError(`找不到画板记录：${id}`)
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || ['id', 'typeName', 'type'].some(key => Object.hasOwn(changes, key))) throw new CanvasEditError('更新不能更改记录 ID 或类型。')
  store.put([{ ...previous, ...changes, ...(changes.props && { props: { ...previous.props, ...changes.props } }), ...(changes.meta && { meta: { ...previous.meta, ...changes.meta } }) }])
}
