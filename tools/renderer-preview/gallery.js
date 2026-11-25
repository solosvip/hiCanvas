import { DefaultColorStyle, GeoShapeGeoStyle, toRichText } from '@tldraw/tlschema'
import { getIndexAbove } from '@tldraw/utils'
import { createCanvasSnapshot } from '../../model/index.js'
import { createEmbedGallery } from './embed-gallery.js'

// Synthetic document coordinates, independent of application UI tokens.
export function createGallery(mode) {
  if (mode === 'embeds') return createEmbedGallery()
  if (!['shapes', 'styles', 'metrics', 'metrics-long', 'metrics-curves'].includes(mode)) throw new Error('未知合成图鉴。')
  const snapshot = createCanvasSnapshot(), store = snapshot.store
  const pageId = Object.values(store).find(r => r.typeName === 'page').id
  let index = 'a0', serial = 0
  const counts = { geo: 0, text: 0, image: 0 }
  const add = (type, x, y, props, opacity = 1) => {
    const id = `shape:gallery-${serial++}`
    store[id] = { id, typeName: 'shape', type, x, y, rotation: 0, index, parentId: pageId, isLocked: false, opacity, meta: {}, props }
    index = getIndexAbove(index); counts[type]++
  }
  const label = (text, x, y, w = 200) => add('text', x, y, { richText: toRichText(text), color: 'black', size: 's', font: 'mono', scale: 1, w, autoSize: false, textAlign: 'start' })
  const geo = (kind, x, y, props = {}, opacity = 1) => add('geo', x, y, { geo: kind, w: 160, h: 96, growY: 0, color: 'blue', labelColor: 'black', fill: 'solid', dash: 'solid', size: 'm', scale: 1, richText: toRichText(''), font: 'sans', align: 'middle', verticalAlign: 'middle', url: '', ...props }, opacity)
  if (mode === 'shapes') {
    GeoShapeGeoStyle.values.forEach((kind, i) => {
      const x = 40 + i % 5 * 240, y = 40 + Math.floor(i / 5) * 176
      geo(kind, x, y, { color: DefaultColorStyle.values[i % DefaultColorStyle.values.length] })
      label(kind, x, y + 108)
    })
  } else if (mode.startsWith('metrics')) {
    // Same synthetic document coordinates as the independently measured old UI.
    const curves = mode === 'metrics-curves', long = mode === 'metrics-long'
    for (const [row, size] of ['s', 'm', 'l', 'xl'].entries()) {
      for (const [col, dash] of (curves ? ['dashed', 'dotted'] : ['solid', 'dashed', 'dotted', 'draw']).entries()) {
        geo(curves ? 'ellipse' : 'rectangle', col * (curves ? 150 : long ? 300 : 130), row * (curves ? 80 : long ? 100 : 75), { w: long ? 240 : 100, h: long || curves ? 50 : 40, size, dash, fill: 'none', color: 'black' })
      }
    }
    if (curves) {
      for (const [col, color] of ['black', 'blue'].entries()) geo('rectangle', col * 150, 350, { w: 120, h: 100, fill: 'lined-fill', color })
    } else {
      for (const [col, fill] of ['none', 'semi', 'solid', 'pattern', 'lined-fill', 'fill'].entries()) {
        geo('rectangle', col * (long ? 150 : 90), long ? 500 : 330, { w: long ? 100 : 65, h: long ? 100 : 65, size: 'm', dash: 'solid', fill, color: 'black' })
      }
    }
  } else {
    const fills = ['none', 'semi', 'solid', 'pattern', 'lined-fill', 'fill']
    fills.forEach((fill, i) => label(fill, 200 + i * 165, 48, 160))
    DefaultColorStyle.values.forEach((color, row) => {
      label(color, 20, 82 + row * 52, 170)
      fills.forEach((fill, col) => geo('rectangle', 200 + col * 165, 75 + row * 52, { w: 125, h: 36, color, fill }))
    })
    const dashes = ['solid', 'dashed', 'dotted', 'draw']
    dashes.forEach((dash, i) => {
      geo('diamond', 40 + i * 300, 790, { w: 170, h: 70, dash, size: ['s', 'm', 'l', 'xl'][i], fill: 'none' }, [1, 0.8, 0.6, 0.4][i])
      label(`${dash} / ${['s', 'm', 'l', 'xl'][i]} / ${[1, 0.8, 0.6, 0.4][i]}`, 40 + i * 300, 874, 290)
    })
  }
  const metricCameras = { metrics: { x: 16, y: 76, z: 4 }, 'metrics-long': { x: 20, y: 175, z: 1.34 }, 'metrics-curves': { x: 104, y: 14, z: 4.6 } }
  const camera = metricCameras[mode] || { x: 20, y: 25, z: mode === 'styles' ? 0.79 : 0.95 }
  return { snapshot, viewState: { currentPageId: pageId, camera }, count: serial, counts, assetCount: 0 }
}
