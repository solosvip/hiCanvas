import { atom } from '@tldraw/state'
import { orderedChildren } from './geometry.js'

const empty = Object.freeze([])
export function createScene(store, pageId) {
  const children = atom('renderer children', new Map())
  const rebuild = () => {
    const previous = children.get(), next = new Map()
    for (const [parent, records] of orderedChildren(store.allRecords())) {
      const ids = records.map(r => r.id), before = previous.get(parent)
      next.set(parent, before?.length === ids.length && ids.every((id, i) => before[i] === id) ? before : ids)
    }
    children.set(next)
  }
  rebuild()
  const dispose = store.listen(({ changes }) => {
    if ([...Object.values(changes.added), ...Object.values(changes.removed)].some(r => r.typeName === 'shape')
      || Object.values(changes.updated).some(([a, b]) => a.typeName === 'shape' && (a.parentId !== b.parentId || a.index !== b.index))) rebuild()
  }, { scope: 'document' })
  return { store, pageId: pageId || store.allRecords().find(r => r.typeName === 'page')?.id, children, ids: parent => children.get().get(parent) || empty, dispose }
}
