import { CanvasEditError } from '../errors.js'

const full = () => ({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export function editableImage(store, id) {
  const shape = store.get(id)
  if (shape?.type !== 'image' || shape.typeName !== 'shape') throw new CanvasEditError('需要一张图片。')
  for (let record = shape; record?.typeName === 'shape'; record = store.get(record.parentId)) if (record.isLocked) throw new CanvasEditError('图片或其容器已锁定。')
  return shape
}

export function imageCrop(shape) {
  const crop = shape.props.crop || full(), { topLeft: a, bottomRight: b } = crop
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite) || a.x < 0 || a.y < 0 || b.x > 1 || b.y > 1 || b.x <= a.x || b.y <= a.y) throw new CanvasEditError('图片裁剪范围必须位于原图内且具有面积。')
  return { ...crop, topLeft: { ...a }, bottomRight: { ...b } }
}

export function imageSourceSize(shape) {
  const { topLeft: a, bottomRight: b } = imageCrop(shape)
  return { w: shape.props.w / (b.x - a.x), h: shape.props.h / (b.y - a.y) }
}

export function imageCropZoom(shape) {
  const size = imageSourceSize(shape), fitHeight = Math.max(shape.props.h, shape.props.w / (size.w / size.h))
  return clamp((size.h / fitHeight - 1) * 50, 0, 100)
}

function fitCrop(shape, crop) {
  const before = imageCrop(shape), size = imageSourceSize(shape)
  const dx = (crop.topLeft.x - before.topLeft.x) * size.w, dy = (crop.topLeft.y - before.topLeft.y) * size.h
  const c = Math.cos(shape.rotation), s = Math.sin(shape.rotation)
  return { ...shape, x: shape.x + dx * c - dy * s, y: shape.y + dx * s + dy * c,
    props: { ...shape.props, w: size.w * (crop.bottomRight.x - crop.topLeft.x), h: size.h * (crop.bottomRight.y - crop.topLeft.y), crop } }
}

export function cropImage(store, { id, operation, preset, crop: requested, delta, value }) {
  const shape = editableImage(store, id)
  let crop = full(), keepFrame = false
  if (operation === 'aspect') {
    const ratios = { square: 1, circle: 1, landscape: 4 / 3, portrait: 3 / 4, wide: 16 / 9 }
    const size = imageSourceSize(shape), ratio = preset === 'original' ? size.w / size.h : ratios[preset]
    if (!ratio) throw new CanvasEditError('未知裁剪比例。')
    const w = Math.min(size.w, size.h * ratio), height = Math.min(size.h, size.w / ratio)
    crop = { topLeft: { x: (size.w - w) / size.w / 2, y: (size.h - height) / size.h / 2 }, bottomRight: { x: (size.w + w) / size.w / 2, y: (size.h + height) / size.h / 2 }, ...(preset !== 'original' && { isCircle: preset === 'circle' }) }
  } else if (operation === 'set') {
    crop = imageCrop({ ...shape, props: { ...shape.props, crop: requested } })
  } else if (operation === 'move' || operation === 'zoom') {
    const before = imageCrop(shape), size = imageSourceSize(shape)
    let w = before.bottomRight.x - before.topLeft.x, height = before.bottomRight.y - before.topLeft.y
    let x = before.topLeft.x, y = before.topLeft.y
    if (operation === 'move') {
      if (![delta?.x, delta?.y].every(Number.isFinite)) throw new CanvasEditError('移图需要有限位移。')
      x -= delta.x / size.w; y -= delta.y / size.h
    } else {
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new CanvasEditError('裁剪缩放范围为 0–100。')
      const ratio = size.w / size.h, fitHeight = Math.max(shape.props.h, shape.props.w / ratio), scale = 1 + value / 50
      w = shape.props.w / (fitHeight * ratio * scale); height = shape.props.h / (fitHeight * scale)
      x += (before.bottomRight.x - before.topLeft.x - w) / 2
      y += (before.bottomRight.y - before.topLeft.y - height) / 2
    }
    x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - height)
    crop = { ...before, topLeft: { x, y }, bottomRight: { x: x + w, y: y + height } }
    keepFrame = true
  } else if (operation !== 'reset') throw new CanvasEditError('未知图片裁剪操作。')
  store.put([keepFrame ? { ...shape, props: { ...shape.props, crop } } : fitCrop(shape, crop)])
  return { shapeId: id }
}
