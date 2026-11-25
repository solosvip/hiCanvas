import { placeMedia } from '../media-placement.js'

export function insertImage(store, { args = {}, image }) {
  const assetId = `asset:${globalThis.crypto.randomUUID()}`
  const { src, name, w, h, mimeType } = image
  store.put([{ id: assetId, typeName: 'asset', type: 'image', props: { name, src, w, h, mimeType, isAnimated: false }, meta: {} }])
  const width = Math.min(w, 512)
  return placeMedia(store, args, { type: 'image', props: { assetId, w: width, h: h / w * width }, meta: args.shapeMeta })
}
