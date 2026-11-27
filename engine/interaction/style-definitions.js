import { DefaultColorStyle, DefaultFontStyle } from '@tldraw/tlschema'
import { geometryVariants } from './creation-presets.js'

export function freezeStyles(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeStyles); Object.freeze(value) }
  return value
}

const colored = ['geo', 'text', 'note', 'arrow', 'line', 'draw', 'highlight']
const labelled = ['geo', 'text', 'note', 'arrow']
const stroked = ['geo', 'arrow', 'line', 'draw']
const alignment = ['start', 'middle', 'end']
const heads = ['none', 'arrow', 'triangle', 'square', 'dot', 'diamond', 'inverted', 'bar']
const prop = (types, choices, initial, field, values = choices) => ({ types, choices, initial, field, values, root: false })

// Document mappings are explicit: note.color is paper, arrowKind is props.kind,
// and changing color never silently changes a labelColor. White is accepted by
// the API/Alt+T, but is not a thirteenth palette button.
export const styleDefinitions = freezeStyles({
  color: prop(colored, DefaultColorStyle.values.filter(value => value !== 'white'), 'black', 'color', [...DefaultColorStyle.values]),
  opacity: { types: '*', choices: [.1, .25, .5, .75, 1], initial: 1, field: 'opacity', root: true },
  fill: prop(['geo', 'draw', 'arrow'], ['none', 'semi', 'solid', 'pattern', 'lined-fill', 'fill'], 'none', 'fill'),
  dash: prop(stroked, ['draw', 'dashed', 'dotted', 'solid'], 'draw', 'dash'),
  size: prop(colored, ['s', 'm', 'l', 'xl'], 'm', 'size'),
  font: prop(labelled, [...DefaultFontStyle.values], 'draw', 'font'),
  textAlign: prop(['text'], alignment, 'start', 'textAlign'),
  align: prop(['geo', 'note'], alignment, 'middle', 'align'),
  verticalAlign: prop(['geo', 'note'], alignment, 'middle', 'verticalAlign'),
  geo: prop(['geo'], geometryVariants, 'rectangle', 'geo'),
  arrowKind: prop(['arrow'], ['arc', 'elbow'], 'arc', 'kind'),
  arrowheadStart: prop(['arrow'], heads, 'none', 'arrowheadStart'),
  arrowheadEnd: prop(['arrow'], heads, 'arrow', 'arrowheadEnd'),
  spline: prop(['line'], ['line', 'cubic'], 'line', 'spline'),
})

export const initialStyles = freezeStyles(Object.fromEntries(Object.entries(styleDefinitions).map(([key, definition]) => [key, definition.initial])))
export const supportsStyle = (shape, definition) => shape?.typeName === 'shape' && shape.type !== 'group' && (definition.types === '*' || definition.types.includes(shape.type))
export const styleValue = (shape, definition) => (definition.root ? shape : shape.props)[definition.field]

// Creation and selection share this registry, including root/props mapping.
// Capture once at pointer-down; geometry updates must not re-read defaults.
export function creationStyles(next, type) {
  const shape = { typeName: 'shape', type }, result = { props: {} }
  for (const [key, definition] of Object.entries(styleDefinitions)) {
    if (supportsStyle(shape, definition)) (definition.root ? result : result.props)[definition.field] = next[key]
  }
  return freezeStyles(result)
}

export function styledCreation(command, styles) {
  // create_shape deliberately retains its standalone document defaults. Root
  // styles use an update inside the same gesture, never new command semantics.
  return [{ ...command, props: { ...command.props, ...styles.props } },
    ...(styles.opacity === 1 ? [] : [{ type: 'update', id: command.id, changes: { opacity: styles.opacity } }])]
}
