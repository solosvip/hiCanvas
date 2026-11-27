import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { videoData } from './video-fixtures.js'

// Distinct positions make a native drag -> undo -> redo visibly identifiable.
// History is established by the driver through real pointers, never prefilled
// with a private editor mutation. Reload creates a fresh memory-only board.
export function createFocusFixture(withVideo = false) {
  const commands = [
    { type: 'create_shape', id: 'shape:focus-a', shapeType: 'geo', x: 300, y: 200, props: { w: 160, h: 100, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:focus-b', shapeType: 'geo', x: 650, y: 200, props: { w: 100, h: 100, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:focus-text', shapeType: 'text', x: 300, y: 450, text: 'Alpha Beta' },
  ]
  if (withVideo) {
    commands[1] = { type: 'create_shape', id: 'shape:focus-video', shapeType: 'video', x: 650, y: 200, props: { w: 320, h: 180, assetId: 'asset:focus-video' } }
    commands.unshift({ type: 'put', record: { id: 'asset:focus-video', typeName: 'asset', type: 'video', props: { src: videoData.mp4, name: 'Synthetic focus video', w: 320, h: 180, mimeType: 'video/mp4', isAnimated: true }, meta: {} } })
  }
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
  return { snapshot, focusFixture: true, count: 3, counts: withVideo ? { geo: 1, text: 1, video: 1 } : { geo: 2, text: 1 }, assetCount: Number(withVideo),
    viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
}
