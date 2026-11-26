import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

export function createActionsGallery() {
  const shape = (id, x, y, props, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { geo: 'rectangle', fill: 'solid', ...props }, ...extra })
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    shape('action-a', 100, 200, { w: 100, h: 80, color: 'blue' }),
    shape('action-b', 330, 250, { w: 80, h: 120, color: 'red' }),
    shape('action-c', 620, 400, { w: 60, h: 40, color: 'green' }),
    { type: 'create_shape', id: 'shape:action-frame', shapeType: 'frame', x: 950, y: 200, props: { w: 260, h: 240, name: '适配与移除框' } },
    shape('action-child', 50, 70, { w: 60, h: 40 }, { parentId: 'shape:action-frame' }),
    shape('action-locked', 400, 650, { w: 100, h: 60, color: 'violet' }),
    { type: 'toggle_lock', ids: ['shape:action-locked'] },
  ]).snapshot
  return { snapshot, selectionActions: true, count: 6, counts: { geo: 5, frame: 1 }, assetCount: 0,
    viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
}
