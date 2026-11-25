import { shapeToPagePoint, pageToShapePoint } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { getTargetShapes } from '../shape-targets.js'
import { getShapeAncestors } from '../shape-coordinates.js'
import { contentBounds, snapshotOf, unlockedShapes } from '../container-geometry.js'
import { updateRecord } from './update.js'

export function fitFrames(store, { ids }) {
  const frames = unlockedShapes(store, getTargetShapes(store, ids))
  if (frames.some(frame => frame.type !== 'frame')) throw new CanvasEditError('适配内容需要有效的画框 ID 列表。')
  const initial = snapshotOf(store)
  frames.sort((a, b) => getShapeAncestors(initial.store, b.parentId).length - getShapeAncestors(initial.store, a.parentId).length)
  for (const frame of frames) {
    const children = store.allRecords().filter(record => record.typeName === 'shape' && record.parentId === frame.id)
    if (!children.length) continue
    const snapshot = snapshotOf(store), bounds = contentBounds(snapshot, children.map(record => record.id), frame.id)
    const origin = pageToShapePoint(snapshot, frame.parentId, shapeToPagePoint(snapshot, frame.id, bounds))
    updateRecord(store, { id: frame.id, changes: { ...origin, props: { w: bounds.w, h: bounds.h } } })
    for (const child of children) updateRecord(store, { id: child.id, changes: { x: child.x - bounds.x, y: child.y - bounds.y } })
  }
}
