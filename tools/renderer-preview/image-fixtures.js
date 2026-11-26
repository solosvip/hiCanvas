import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

// Four unequal colour regions make reflections and source offsets observable.
export const imageGrid = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><path fill="red" d="M0 0h80v60H0z"/><path fill="lime" d="M80 0h160v60H80z"/><path fill="blue" d="M0 60h80v120H0z"/><path fill="yellow" d="M80 60h160v120H80z"/></svg>')}`

// 2×2 red/green frames, 200ms each, looping. Literal GIF LZW clear codes keep
// this synthetic fixture inspectable without an encoder or network dependency.
const bytes = [71,73,70,56,57,97,2,0,2,0,128,0,0,255,0,0,0,255,0,
  33,255,11,78,69,84,83,67,65,80,69,50,46,48,3,1,0,0,0]
for (const color of [0, 1]) {
  bytes.push(33,249,4,4,20,0,0,0,44,0,0,0,0,2,0,2,0,0,2)
  const codes = [4,color,4,color,4,color,4,color,5]
  let bits = 0, count = 0
  const data = []
  for (const code of codes) { bits |= code << count; count += 3; if (count >= 8) { data.push(bits & 255); bits >>>= 8; count -= 8 } }
  if (count) data.push(bits)
  bytes.push(data.length, ...data, 0)
}
bytes.push(59)
export const animatedImage = `data:image/gif;base64,${btoa(String.fromCharCode(...bytes))}`

export function createImageGallery(initial = createCanvasSnapshot(), single = false) {
  const variants = single ? [{}] : [{}, { flipX: true }, { flipY: true }, { crop: { topLeft: { x: .25, y: .25 }, bottomRight: { x: .75, y: .75 } } }, { crop: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 }, isCircle: true } }, { assetId: 'asset:image-animation' }]
  const commands = [{ type: 'put', record: { id: 'asset:image-grid', typeName: 'asset', type: 'image', props: { name: 'Synthetic grid', src: imageGrid, w: 240, h: 180, mimeType: 'image/svg+xml', isAnimated: false }, meta: {} } },
    { type: 'put', record: { id: 'asset:image-animation', typeName: 'asset', type: 'image', props: { name: 'Synthetic animation', src: animatedImage, w: 2, h: 2, mimeType: 'image/gif', isAnimated: true }, meta: {} } },
    ...variants.map((props, i) => ({ type: 'create_shape', id: `shape:image-${i}`, shapeType: 'image', x: 100 + i % 3 * 300, y: 120 + Math.floor(i / 3) * 260, props: { assetId: 'asset:image-grid', w: 240, h: 180, ...props } }))]
  const snapshot = executeCanvasCommands(initial, commands).snapshot, pageId = Object.values(snapshot.store).find(r => r.typeName === 'page').id
  return { snapshot, count: variants.length, counts: { image: variants.length }, assetCount: 2, viewState: { version: 1, currentPageId: pageId, camera: { x: 0, y: 0, z: 1 } } }
}
