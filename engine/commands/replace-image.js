import { CanvasEditError } from '../errors.js'
import { editableImage } from './crop-image.js'

export function replaceImage(store, { id, image, assetId = `asset:${globalThis.crypto.randomUUID()}` }) {
  const shape = editableImage(store, id)
  if (!image || ![image.w, image.h].every(n => Number.isFinite(n) && n > 0) || typeof image.src !== 'string' || !image.src || !/^image\//.test(image.mimeType || '')) throw new CanvasEditError('替换图片需要来源、尺寸和图片类型。')
  if (typeof assetId !== 'string' || !assetId.startsWith('asset:') || store.has(assetId)) throw new CanvasEditError('新图片资产 ID 无效或已存在。')
  const { w, h, src, mimeType, isAnimated = false } = image
  // #137 native chooser on isolated 240×180 flipped/cropped image, 2026-11-26:
  // legacy 160×320 → crop(.2,.3875)–(.8,.6125); 4096×256 →
  // (.486111,.333333)–(.513889,.666667). Keep #139's intentional fresh
  // center-cover below rather than carrying that old source-relative view.
  const scale = Math.max(shape.props.w / w, shape.props.h / h)
  const width = shape.props.w / (w * scale), height = shape.props.h / (h * scale)
  const crop = width === 1 && height === 1 ? null : { topLeft: { x: (1 - width) / 2, y: (1 - height) / 2 }, bottomRight: { x: (1 + width) / 2, y: (1 + height) / 2 } }
  store.put([{ id: assetId, typeName: 'asset', type: 'image', props: { name: image.name || 'Image', src, w, h, mimeType, isAnimated: Boolean(isAnimated) }, meta: {} },
    { ...shape, props: { ...shape.props, assetId, crop, playing: true } }])
  return { shapeId: id, assetId }
}
