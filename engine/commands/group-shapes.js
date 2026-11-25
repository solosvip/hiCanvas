import { getIndicesBetween } from '@tldraw/utils'
import { getTargetShapes } from '../shape-targets.js'
import { getShapeAncestors } from '../shape-coordinates.js'
import { contentBounds, reparentPose, snapshotOf, unlockedShapes } from '../container-geometry.js'
import { createShape } from './create-shape.js'
import { updateRecord } from './update.js'
import { rememberGrouping } from '../group-provenance.js'

export function groupShapes(store, { ids, groupId = `shape:${globalThis.crypto.randomUUID()}` }) {
  const snapshot = snapshotOf(store), selected = unlockedShapes(store, getTargetShapes(store, ids)), selectedIds = new Set(selected.map(shape => shape.id))
  const roots = selected.filter(shape => !getShapeAncestors(snapshot.store, shape.parentId).some(parent => selectedIds.has(parent.id)))
  if (roots.length < 2) return null
  const chains = roots.map(shape => [...getShapeAncestors(snapshot.store, shape.parentId).map(parent => parent.id), getShapeAncestors(snapshot.store, shape.parentId).at(-1)?.parentId || shape.parentId])
  const parentId = chains[0].find(id => chains.every(chain => chain.includes(id)))
  const path = shape => {
    const chain = [shape, ...getShapeAncestors(snapshot.store, shape.parentId)]
    return chain.slice(0, chain.findIndex(record => record.parentId === parentId) + 1).reverse()
  }
  roots.sort((a, b) => {
    const left = path(a), right = path(b)
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i].index !== right[i].index) return left[i].index < right[i].index ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const top = path(roots.at(-1))[0], next = store.allRecords().filter(record => record.typeName === 'shape' && record.parentId === parentId && record.index > top.index).map(record => record.index).sort()[0]
  const index = selectedIds.has(top.id) ? top.index : getIndicesBetween(top.index, next, 1)[0]
  const bounds = contentBounds(snapshot, roots.map(shape => shape.id), parentId)
  createShape(store, { id: groupId, shapeType: 'group', parentId, x: bounds.x, y: bounds.y })
  updateRecord(store, { id: groupId, changes: { index } })
  const sameParent = roots.every(shape => shape.parentId === parentId)
  if (sameParent) updateRecord(store, { id: groupId, changes: { meta: rememberGrouping(store.get(groupId), roots) } })
  const grouped = snapshotOf(store)
  const indices = sameParent ? roots.map(shape => shape.index) : getIndicesBetween(null, null, roots.length)
  for (const [i, shape] of roots.entries()) updateRecord(store, { id: shape.id, changes: { ...reparentPose(grouped, shape, groupId), parentId: groupId, index: indices[i] } })
  return { groupId }
}
