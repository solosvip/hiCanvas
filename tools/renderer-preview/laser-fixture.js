import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

// Memory-only boards: no user canvas, settings, images or external resources.
export function createLaserFixture(mode = 'scene') {
  const initial = createCanvasSnapshot()
  const commands = mode === 'empty' ? [] : [
    { type: 'create_shape', id: 'shape:laser-geo', shapeType: 'geo', x: 600, y: 200, props: { w: 140, h: 100, fill: 'solid', color: 'blue' } },
    { type: 'create_shape', id: 'shape:laser-text', shapeType: 'text', x: 100, y: 200, text: 'Alpha Beta' },
  ]
  const snapshot = commands.length ? executeCanvasCommands(initial, commands).snapshot : initial
  return { snapshot, laserFixture: true, count: commands.length, counts: mode === 'empty' ? {} : { geo: 1, text: 1 }, assetCount: 0,
    viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
}
