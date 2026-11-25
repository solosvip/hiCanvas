import { isEqual } from '@tldraw/utils'

// 目标已校验并迁移；只换真正不同的记录，保留未改记录的对象和订阅。
export function restoreCanvasRecords(store, snapshot) {
  const remove = store.allRecords().filter(record => !Object.hasOwn(snapshot.store, record.id)).map(record => record.id)
  const put = Object.values(snapshot.store).filter(record => !isEqual(store.get(record.id), record)).map(record => structuredClone(record))
  store.atomic(() => {
    if (remove.length) store.remove(remove)
    if (put.length) store.put(put)
  }, false)
}
