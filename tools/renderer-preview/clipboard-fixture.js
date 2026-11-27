import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

export function createClipboardFixture({ empty = false } = {}) {
  const snapshot = empty ? createCanvasSnapshot() : executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:clipboard-a', shapeType: 'geo', x: 100, y: 160, props: { w: 100, h: 80, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:clipboard-b', shapeType: 'geo', x: 340, y: 260, props: { w: 80, h: 120, fill: 'solid' } },
  ]).snapshot
  return { snapshot, clipboardFixture: true, count: empty ? 0 : 2, counts: { geo: empty ? 0 : 2 }, assetCount: 0, viewState: { currentPageId: 'page:page', camera: { x: 0, y: 0, z: 1 } } }
}
