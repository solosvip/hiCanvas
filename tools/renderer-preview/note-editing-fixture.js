import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

export function createNoteEditingFixture() {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:note', shapeType: 'note', x: 300, y: 300, text: 'Source' },
    { type: 'create_shape', id: 'shape:moving', shapeType: 'note', x: 850, y: 300, text: 'Moving' },
    { type: 'create_shape', id: 'shape:scaled', shapeType: 'note', x: 800, y: 550, text: 'Scaled', props: { scale: .5 } },
    { type: 'create_shape', id: 'shape:rtl', shapeType: 'note', x: 300, y: 550, text: 'مرحبا' },
  ]).snapshot
  const currentPageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id
  return { snapshot, noteEditingFixture: true, count: 4, counts: {}, assetCount: 0, viewState: { currentPageId, camera: { x: 0, y: 0, z: 1 } } }
}
