import { CanvasEditError } from '../errors.js'
import { editableImage } from './crop-image.js'

export function setImageAltText(store, { id, altText }) {
  const shape = editableImage(store, id)
  if (typeof altText !== 'string' || altText.length > 10000) throw new CanvasEditError('替代文字需要不超过 10000 字的文字。')
  store.put([{ ...shape, props: { ...shape.props, altText } }])
  return { shapeId: id }
}
