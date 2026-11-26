import { createCanvasSnapshot } from '../../model/index.js'

// A blank, disposable board for exercising creation with native input. It has
// no connection to the user's canvases, model settings or generation APIs.
export function createCreationFixture() {
  const snapshot = createCanvasSnapshot()
  const currentPageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id
  return { snapshot, count: 0, counts: {}, assetCount: 0, viewState: { currentPageId, camera: { x: 0, y: 0, z: 1 } } }
}
