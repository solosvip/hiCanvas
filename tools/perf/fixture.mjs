import { crc32, deflateSync } from 'node:zlib'
import { getIndexAbove } from '@tldraw/utils'
import { toRichText } from '@tldraw/tlschema'
import { createCanvasSnapshot } from '../../model/index.js'
import { benchmarkViewport, checkedDash } from './config.mjs'

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([size, body, crc])
}

// Seeded raster content, generated locally; no image provider, external URL or
// downloaded sample. Separate assets share texture data, not shape identities.
export function syntheticPng(seed, width = 256, height = 192) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc((width * 3 + 1) * height)
  let state = seed + 1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const offset = y * (width * 3 + 1) + 1 + x * 3
    pixels[offset] = (x + seed * 31) & 255
    pixels[offset + 1] = (y + seed * 47) & 255
    pixels[offset + 2] = state >>> 24
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

export function createFixture(count, initialSnapshot, viewport = benchmarkViewport, { dash = 'solid' } = {}) {
  checkedDash(dash)
  const snapshot = createCanvasSnapshot(initialSnapshot), store = snapshot.store
  const pageId = Object.values(store).find(r => r.typeName === 'page').id
  const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns)
  const imageCount = Math.floor((count + 3) / 5), assetCount = Math.min(16, imageCount)
  for (let i = 0; i < assetCount; i++) {
    const bytes = syntheticPng(i), id = `asset:perf-${i}`
    store[id] = { id, typeName: 'asset', type: 'image', meta: {}, props: { name: `synthetic-${i}.png`, src: `data:image/png;base64,${bytes.toString('base64')}`, w: 256, h: 192, mimeType: 'image/png', isAnimated: false, fileSize: bytes.length } }
  }
  let index = 'a0'
  const textProps = { color: 'black', size: 'm', font: 'sans', scale: 1 }
  for (let i = 0; i < count; i++) {
    const id = `shape:perf-${i}`, type = i % 5 === 1 ? 'image' : i % 5 === 2 ? 'text' : 'geo'
    const common = { ...textProps, richText: toRichText(type === 'text' ? `合成 ${i}\nSynthetic canvas` : '') }
    const props = type === 'image' ? { w: 96, h: 72, assetId: `asset:perf-${Math.floor(i / 5) % assetCount}`, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: `合成图片 ${i}` }
      : type === 'text' ? { ...common, w: 104, textAlign: 'start', autoSize: false }
        : { ...common, w: 96, h: 72, geo: ['rectangle', 'ellipse', 'triangle', 'diamond'][i % 4], dash, growY: 0, url: '', labelColor: 'black', color: ['blue', 'green', 'violet'][i % 3], fill: 'semi', align: 'middle', verticalAlign: 'middle' }
    store[id] = { id, typeName: 'shape', type, x: (i % columns) * 128, y: Math.floor(i / columns) * 104, rotation: 0, index, parentId: pageId, isLocked: false, opacity: 1, props, meta: {} }
    index = getIndexAbove(index)
  }
  const width = columns * 128, height = rows * 104
  const z = Math.min((viewport.width - 160) / width, (viewport.height - 160) / height)
  const camera = { x: (viewport.width / z - width) / 2, y: (viewport.height / z - height) / 2, z }
  // Keep the pointer target above overlapping hit margins at low zoom, while
  // retaining the exact same element/type counts and normal element dimensions.
  const targetId = `shape:perf-${count - 1}`, target = store[targetId]
  target.x = width / 2 - 48; target.y = height / 2 - 36
  if (target.type === 'geo') target.props.geo = 'rectangle'
  return { snapshot, viewState: { version: 1, currentPageId: pageId, camera }, count, counts: { image: imageCount, text: Math.floor((count + 2) / 5), geo: count - imageCount - Math.floor((count + 2) / 5) }, assetCount, targetId, viewport }
}
