import { getIndexAbove } from '@tldraw/utils'
import { createCanvasSnapshot } from '../../model/index.js'
import { externalSamples } from './external-samples.js'

// Only the automated browser harness opens this gallery. Its request handler
// redirects the synthetic provider URLs to fake-embed.html before any network.
export function createExternalGallery() {
  const snapshot = createCanvasSnapshot(), store = snapshot.store
  const pageId = Object.values(store).find(record => record.typeName === 'page').id
  let index = 'a1'
  const bases = externalSamples.filter(sample => sample.kind === 'base')
  bases.forEach((sample, i) => {
    const id = `shape:external-${sample.id}`, [w, height] = sample.size || [720, 500]
    store[id] = { id, typeName: 'shape', type: 'embed', x: i % 3 * 900 + 20, y: Math.floor(i / 3) * 650 + 320, rotation: i === 1 ? .1 : 0, index, parentId: pageId, isLocked: false, opacity: i === 1 ? .8 : 1, meta: {}, props: { w, h: height, url: sample.input } }
    index = getIndexAbove(index)
  })
  return { snapshot, viewState: { currentPageId: pageId, camera: { x: 10, y: 10, z: .18 } }, count: bases.length, counts: { embed: bases.length }, assetCount: 0 }
}
