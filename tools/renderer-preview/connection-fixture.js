import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

export function createConnectionEditingFixture() {
  const commands = [
    { type: 'create_shape', id: 'shape:target', shapeType: 'geo', x: 650, y: 200, props: { w: 150, h: 150, fill: 'semi' } },
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 200, y: 450, text: 'Arrow label', props: { end: { x: 400, y: 0 } } },
    { type: 'create_shape', id: 'shape:line', shapeType: 'line', x: 200, y: 650, props: { points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 400, y: 0 } } } },
    { type: 'create_shape', id: 'shape:elbow', shapeType: 'arrow', x: 750, y: 500, props: { kind: 'elbow', end: { x: 400, y: 150 } } },
  ]
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
  const currentPageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id
  return { snapshot, connectionEditingFixture: true, count: commands.length, counts: {}, assetCount: 0, viewState: { currentPageId, camera: { x: 0, y: 0, z: 1 } } }
}
