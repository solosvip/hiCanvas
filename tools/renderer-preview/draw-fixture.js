import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

export function createDrawGallery() {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:draw-frame', shapeType: 'frame', x: 920, y: 100, props: { w: 240, h: 300, name: '框内起笔保留归属' } },
  ]).snapshot
  return { snapshot, drawInput: true, count: 1, counts: { frame: 1 }, assetCount: 0,
    viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
}
