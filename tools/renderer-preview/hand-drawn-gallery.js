import { toRichText } from '@tldraw/tlschema'
import { createCanvasSnapshot } from '../../model/index.js'

// #79: identical IDs, document sizes and positions in both black-box sheets.
export function createHandDrawnGallery(mode) {
  const snapshot = createCanvasSnapshot(), store = snapshot.store
  const pageId = Object.values(store).find(record => record.typeName === 'page').id
  const stress = mode.includes('stress'), solid = mode.endsWith('solid'), filled = mode === 'draw-filled'
  const kinds = ['rectangle', 'ellipse', 'star', 'triangle'], sizes = ['s', 'm', 'l', 'xl']
  const count = stress ? 5000 : 16, columns = stress ? Math.ceil(Math.sqrt(count)) : 4
  for (let i = 0; i < count; i++) {
    const geo = stress ? kinds[i % 4] : kinds[Math.floor(i / 4)], size = stress ? 'm' : sizes[i % 4]
    const index = `c${i.toString(36).padStart(3, '0')}`
    const id = stress ? `shape:hand-stress-${i}` : `shape:hand-${geo}-${size}`
    store[id] = { id, typeName: 'shape', type: 'geo', parentId: pageId, index, x: i % columns * (stress ? 128 : 300), y: Math.floor(i / columns) * (stress ? 104 : 220), rotation: 0, isLocked: false, opacity: 1, meta: {}, props: { geo, w: stress ? 96 : 160, h: stress ? 72 : 100, growY: 0, color: 'black', labelColor: 'black', size, scale: 1, fill: filled ? 'solid' : 'none', dash: solid ? 'solid' : 'draw', richText: toRichText(''), font: 'sans', align: 'middle', verticalAlign: 'middle', url: '' } }
  }
  const z = stress ? Math.min(1120 / (columns * 128), 640 / (Math.ceil(count / columns) * 104)) : 0.9
  const camera = stress ? { x: (1280 / z - columns * 128) / 2, y: (800 / z - Math.ceil(count / columns) * 104) / 2, z } : { x: 60, y: 60, z }
  return { snapshot, count, counts: { geo: count, image: 0, text: 0 }, assetCount: 0, viewState: { currentPageId: pageId, camera } }
}
