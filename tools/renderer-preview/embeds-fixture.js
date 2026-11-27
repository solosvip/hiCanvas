import { createCanvasSnapshot } from '../../model/index.js'

export function createEmbedsFixture() {
  const snapshot = createCanvasSnapshot(), pageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id
  return { snapshot, viewState: { currentPageId: pageId, camera: { x: 0, y: 0, z: 1 } }, count: 0, counts: {}, assetCount: 0, embedsFixture: true, clipboardFixture: true }
}
