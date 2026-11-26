import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

export function createSelectionGallery() {
  const shape = (id, x, y, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { w: 80, h: 60, fill: 'solid' }, ...extra })
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    shape('a', 100, 100), shape('b', 300, 100), shape('c', 200, 220), shape('d', 100, 400),
    shape('e', 600, 300), shape('f', 760, 300), shape('h', 600, 500), shape('i', 760, 500),
    { type: 'group_shapes', ids: ['shape:h', 'shape:i'], groupId: 'shape:inner' },
    { type: 'group_shapes', ids: ['shape:e', 'shape:f', 'shape:inner'], groupId: 'shape:outer' },
    shape('frame', 950, 100, { shapeType: 'frame', props: { w: 200, h: 250 } }), shape('child', 20, 20, { parentId: 'shape:frame' }),
  ]).snapshot
  const pageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id
  return { snapshot, count: 12, counts: { geo: 9, group: 2, frame: 1 }, assetCount: 0, viewState: { currentPageId: pageId, camera: { x: 0, y: 0, z: 1 } } }
}
