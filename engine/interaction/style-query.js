import { freezeStyles, styleDefinitions, styleValue, supportsStyle } from './style-definitions.js'

// Groups expose leaf styles, including locked descendants. Query membership is
// deliberately broader than action eligibility; a locked child can keep Mixed.
export function styleShapes(records, selectedIds) {
  const pending = [...selectedIds], seen = new Set(), shapes = []
  for (const id of pending) {
    if (seen.has(id)) continue
    seen.add(id)
    const shape = records.getRecord(id)
    if (shape?.typeName !== 'shape') continue
    if (shape.type === 'group') pending.push(...records.childIds(id))
    else shapes.push(shape)
  }
  return shapes
}

export function queryStyles(next, selectedIds, shapes = []) {
  const selected = selectedIds.length > 0
  return freezeStyles({ source: selected ? 'selection' : 'next', selectionCount: selectedIds.length, next, styles: Object.fromEntries(
    Object.entries(styleDefinitions).map(([key, definition]) => {
      const values = shapes.filter(shape => supportsStyle(shape, definition)).map(shape => styleValue(shape, definition))
      const state = !selected ? 'shared' : !values.length ? 'unsupported' : values.every(value => value === values[0]) ? 'shared' : 'mixed'
      return [key, { key, choices: definition.choices, state, supportedCount: values.length, ...(state === 'shared' && { value: selected ? values[0] : next[key] }) }]
    }),
  ) })
}
