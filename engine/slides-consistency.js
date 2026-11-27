import { isSlidesContainer, isSlidesPage, planSlidesLayout } from './slides-layout.js'
import { updateRecord } from './commands/update.js'
import { reparentShapes } from './commands/reparent-shapes.js'
import { isEqual } from '@tldraw/utils'
import { CanvasEditError } from './errors.js'

const locked = () => { throw new CanvasEditError('幻灯片里有锁定的页，无法重新排版。', 'slides-layout-locked') }
function lineage(get, record) {
  const result = [], seen = new Set()
  for (let r = record; r?.typeName === 'shape' && !seen.has(r.id); r = get(r.parentId)) { seen.add(r.id); result.push(r) }
  return result
}

// Change journals and the Store's parent index restrict work to affected decks.
// In particular, an unrelated transaction never queries any deck's children.
export function reconcileSlides(store, journal, implicitParents) {
  const pending = new Set()
  const original = new Map()
  for (const diff of journal) {
    for (const record of Object.values(diff.added)) if (!original.has(record.id)) original.set(record.id, null)
    for (const record of [...Object.values(diff.removed), ...Object.values(diff.updated).map(([before]) => before)]) if (!original.has(record.id)) original.set(record.id, record)
  }
  // Intermediate writes can cancel within a batch. Only its net changes
  // authorize reflow; a no-op must not migrate an otherwise untouched deck.
  for (const [id, before] of original) {
    const after = store.get(id)
    if (isEqual(before, after)) continue
    for (const record of [before, after]) {
      if (record?.typeName !== 'shape') continue
      pending.add(record.parentId)
      if (isSlidesContainer(record)) pending.add(record.id)
    }
  }
  const getBefore = id => original.has(id) ? original.get(id) : store.get(id)
  for (const [id, before] of original) {
    if (before?.typeName !== 'shape') continue
    const after = store.get(id)
    // Changing the lock itself is allowed. Other edits must honor the old
    // ancestry, including deletion of the last child of a locked container.
    if (after && isEqual({ ...before, isLocked: after.isLocked }, after)) continue
    const ancestors = lineage(getBefore, before)
    if (ancestors.some(isSlidesContainer) && ancestors.some(r => r.isLocked)) locked()
  }
  for (const id of implicitParents) {
    const shape = store.get(id), target = store.get(shape?.meta?.cowartAiSlidesParentShapeId)
    // Only an unparented new candidate may consume an auto-adoption hint.
    // Groups and copied descendants always carry explicit ancestry.
    if (!isSlidesPage(shape) || store.get(shape.parentId)?.typeName !== 'page' || !isSlidesContainer(target)) continue
    if (lineage(key => store.get(key), target).some(r => r.isLocked) || shape.isLocked) continue
    reparentShapes(store, { ids: [id], parentId: target.id })
    pending.add(target.id)
  }
  for (const [id, before] of original) {
    const after = store.get(id)
    if (!isSlidesPage(after) || !Object.hasOwn(after.meta, 'cowartAiSlidesParentShapeId') || before && before.parentId === after.parentId) continue
    const meta = { ...after.meta }, parent = store.get(after.parentId)
    if (isSlidesContainer(parent)) meta.cowartAiSlidesParentShapeId = parent.id
    else delete meta.cowartAiSlidesParentShapeId
    if (!isEqual(meta, after.meta)) store.put([{ ...after, meta }])
  }
  for (const id of pending) {
    const container = store.get(id)
    if (!isSlidesContainer(container)) continue
    const children = store.query.records('shape', () => ({ parentId: { eq: id } })).get()
    const updates = planSlidesLayout(container, children)
    for (const update of updates) if (lineage(id => store.get(id), store.get(update.id)).some(r => r.isLocked)) locked()
    for (const { id: shapeId, type: _type, ...changes } of updates) updateRecord(store, { id: shapeId, changes })
  }
}
