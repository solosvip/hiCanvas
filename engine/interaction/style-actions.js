import { CanvasEditError } from '../errors.js'
import { styleDefinitions, styleValue, supportsStyle } from './style-definitions.js'

export function checkedStyles(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new CanvasEditError('样式需要一个选项对象。')
  for (const [key, value] of Object.entries(patch)) {
    const definition = Object.hasOwn(styleDefinitions, key) && styleDefinitions[key]
    const valid = definition && (key === 'opacity' ? Number.isFinite(value) && value >= 0 && value <= 1 : definition.values.includes(value))
    if (!valid) throw new CanvasEditError(`无效的样式选项：${key}。`)
  }
  return { ...patch }
}

// A frame is a style target itself; only groups expand into descendants.
// Eligibility is supplied by editing's existing ancestor lock/visibility rules.
export function planStyles(shapes, values, editable) {
  const commands = [], adopted = {}
  for (const shape of shapes) {
    if (!editable(shape.id)) continue
    const changes = {}, props = {}
    for (const [key, value] of Object.entries(values)) {
      const definition = styleDefinitions[key]
      if (!supportsStyle(shape, definition)) continue
      adopted[key] = value
      if (styleValue(shape, definition) === value) continue
      ;(definition.root ? changes : props)[definition.field] = value
    }
    if (Object.keys(props).length) changes.props = props
    if (Object.keys(changes).length) commands.push({ type: 'update', id: shape.id, changes })
  }
  return { commands, adopted }
}
