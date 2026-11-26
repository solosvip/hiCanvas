import { createConnectionContext, getBoundArrowIds } from './connection-records.js'
import { getConnectionGeometry } from './connection-geometry.js'

// One relationship index/subscription per Store, shared by mounted connections.
// Last unsubscribe releases it. A target/ancestor change invalidates only the
// connected arrows; unrelated records do not recompute their geometry.
const views = new WeakMap()
export function connectionView(store) {
  if (views.has(store)) return views.get(store)
  let context = createConnectionContext(store.allRecords()), stop = null
  const cache = new Map(), listeners = new Map()
  function addDescendantConnections(id, affected, seen = new Set()) {
    if (seen.has(id)) return
    seen.add(id)
    const record = context.getRecord(id)
    if (record?.type === 'arrow' || record?.type === 'line') affected.add(id)
    for (const child of context.childIds(id)) addDescendantConnections(child, affected, seen)
  }
  function related(records, affected) {
    for (const record of records) {
      if (record.typeName === 'binding' && record.type === 'arrow') affected.add(record.fromId)
      if (record.typeName !== 'shape') continue
      getBoundArrowIds(context, record).forEach(id => affected.add(id))
      addDescendantConnections(record.id, affected)
    }
  }
  function update({ changes }) {
    const old = [...Object.values(changes.removed), ...Object.values(changes.updated).map(pair => pair[0])]
    const next = [...Object.values(changes.added), ...Object.values(changes.updated).map(pair => pair[1])]
    const affected = new Set()
    related(old, affected); context.applyChanges(changes); related(next, affected)
    for (const id of affected) { cache.delete(id); listeners.get(id)?.forEach(notify => notify()) }
  }
  const view = Object.freeze({
    get(id) {
      if (!cache.has(id)) {
        const record = context.getRecord(id)
        cache.set(id, record ? getConnectionGeometry(record, context) : null)
      }
      return cache.get(id)
    },
    subscribe(id, notify) {
      if (!stop) {
        context = createConnectionContext(store.allRecords()); cache.clear()
        stop = store.addHistoryInterceptor(update)
      }
      if (!listeners.has(id)) listeners.set(id, new Set())
      listeners.get(id).add(notify)
      return () => {
        const subscribers = listeners.get(id); subscribers?.delete(notify)
        if (!subscribers?.size) { listeners.delete(id); cache.delete(id) }
        // Keep the weak registration: React can unsubscribe then resubscribe
        // the same view. Weak keys still release the view with its Store.
        if (!listeners.size) { stop?.(); stop = null; cache.clear() }
      }
    },
  })
  views.set(store, view)
  return view
}
