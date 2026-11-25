import { getTargetShapes } from '../shape-targets.js'

export function toggleLock(store, { ids }) {
  const shapes = getTargetShapes(store, ids)
  const isLocked = !shapes.every(shape => shape.isLocked)
  store.put(shapes.filter(shape => shape.isLocked !== isLocked).map(shape => ({ ...shape, isLocked })))
}

export function unlockAll(store) {
  store.put(store.allRecords().filter(record => record.typeName === 'shape' && record.isLocked).map(shape => ({ ...shape, isLocked: false })))
}
