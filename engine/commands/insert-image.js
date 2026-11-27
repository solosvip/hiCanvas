import { placeMedia } from '../media-placement.js'
import { CanvasEditError } from '../errors.js'

export function insertImage(store, { args = {}, image }) {
  // Empty src is the existing server dry-run placeholder; prepared file
  // imports require an uploaded source at the public media intake instead.
  if (!image || ![image.w, image.h].every(n => Number.isFinite(n) && n > 0) || typeof image.src !== 'string' || !/^image\//.test(image.mimeType || '')) throw new CanvasEditError('图片需要有效的来源、尺寸和类型。')
  const assetId = `asset:${globalThis.crypto.randomUUID()}`
  const { src, name = 'Image', w, h, mimeType, isAnimated = false } = image
  store.put([{ id: assetId, typeName: 'asset', type: 'image', props: { name, src, w, h, mimeType, isAnimated: Boolean(isAnimated) }, meta: {} }])
  const width = Math.min(w, 512)
  return placeMedia(store, args, { type: 'image', props: { assetId, w: width, h: h / w * width }, meta: args.shapeMeta })
}
