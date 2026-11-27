// Input has already passed normalizeInput (#122). Keep its key / code / modifier
// contract: ordinary bindings compare lower-case key; explicit Alt bindings use
// code when present, because macOS Option+A produces key="å", code="KeyA".
// No DOM, platform sniffing or second input normalization lives here.
import { canvasActions } from '../actions/index.js'
const binding = (id, keys, options = {}) => Object.freeze({ id, keys: Object.freeze(keys), phase: 'down', ...options })
const plain = { mod: false, alt: false, shift: false, repeat: false }
const notPanning = state => state.temporaryTool !== 'hand'
export const canvasShortcutBindings = Object.freeze([
  // Selection/navigation historically fold case; crop/tools require the
  // canonical Escape spelling. Preserve both existing normalized-input contracts.
  binding('escape', ['Escape'], { phase: 'both', exact: true }),
  binding('escape-folded', ['escape'], { phase: 'both', aliasOf: 'escape' }),
  binding('space', [' '], { phase: 'both', codeAlias: 'Space' }),
  binding('comma', [','], { mod: false, alt: false, shift: false, codeAlias: 'Comma' }),
  binding('comma-release', [','], { phase: 'up', codeAlias: 'Comma', aliasOf: 'comma' }),
  binding('pan-key-gate', [], { phase: 'both', keyPrefix: 'Arrow', aliasOf: 'pan-direction', when: state => state.temporaryTool === 'hand' }),
  binding('pan-direction', ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], { phase: 'both', when: state => state.temporaryTool === 'hand' }),
  binding('history', ['z'], { mod: true }),
  binding('style-white', ['t'], { ...plain, alt: true, codes: ['KeyT'], group: 'style', patch: Object.freeze({ color: 'white' }) }),
  binding('style-fill', ['f'], { ...plain, alt: true, codes: ['KeyF'], group: 'style', patch: Object.freeze({ fill: 'fill' }) }),
  binding('style-lined-fill', ['f'], { ...plain, alt: true, shift: true, codes: ['KeyF'], group: 'style', patch: Object.freeze({ fill: 'lined-fill' }) }),
  binding('selection-cycle', ['tab'], { phase: 'both', mod: false, alt: false }),
  binding('selection-enter', ['enter'], { phase: 'both', mod: false, alt: false, shift: false, when: state => !state.croppingId && state.selectionType === 'group' }),
  binding('selection-all', ['a'], { mod: true, alt: false, shift: false }),
  // Modifier presses mid-gesture re-run the move: Shift axis lock, Alt duplicate
  // (#125), Control/Meta snapping inversion (#128).
  binding('selection-modifiers', ['Control', 'Meta', 'Shift', 'Alt'], { phase: 'both', exact: true }),
  binding('selection-neighbor', ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], { mod: true, alt: false, shift: false, when: notPanning }),
  binding('selection-parent', ['arrowup'], { mod: true, alt: false, shift: true, when: notPanning }),
  binding('selection-child', ['arrowdown'], { mod: true, alt: false, shift: true, when: notPanning }),
  binding('draw', ['d'], { ...plain, group: 'draw', tool: 'draw' }),
  binding('draw-alias', ['b', 'x'], { ...plain, shift: undefined, group: 'draw', tool: 'draw' }),
  binding('highlight', ['d'], { ...plain, shift: true, group: 'draw', tool: 'highlight' }),
  binding('tool-eraser', ['e'], { ...plain, tool: 'eraser' }),
  binding('tool-laser', ['k'], { ...plain, tool: 'laser' }),
  binding('create-rectangle', ['r'], { ...plain, group: 'creation', tool: 'geo', geo: 'rectangle' }),
  binding('create-ellipse', ['o'], { ...plain, group: 'creation', tool: 'geo', geo: 'ellipse' }),
  binding('create-geo', ['g'], { ...plain, group: 'creation', tool: 'geo' }),
  binding('create-frame', ['f'], { ...plain, group: 'creation', tool: 'frame' }),
  binding('create-text', ['t'], { ...plain, group: 'creation', tool: 'text' }),
  binding('create-note', ['n'], { ...plain, group: 'creation', tool: 'note' }),
  binding('create-line', ['l'], { ...plain, group: 'creation', tool: 'line' }),
  binding('create-ai-image', ['a'], { ...plain, group: 'creation', tool: 'ai-image' }),
  binding('creation-lock', ['q'], { ...plain, group: 'creation' }),
  binding('tool-hand', ['h'], { ...plain, group: 'camera-tool', tool: 'hand' }),
  binding('tool-select', ['v'], { ...plain, group: 'camera-tool', tool: 'select' }),
  binding('camera-zoom', ['=', '+', '-'], { repeat: false, except: input => Boolean(input.metaKey || input.ctrlKey) && input.altKey && input.shiftKey }),
  binding('camera-view', ['0', '1', '2'], { shift: true, repeat: false }),
  binding('zoom-hold', ['z'], { mod: false, alt: false }),
  binding('zoom-release', ['z'], { phase: 'up' }),
  binding('crop-enter', ['Enter'], { exact: true, when: state => Boolean(state.croppingId || state.selectionType === 'image') }),
  ...canvasActions.filter(action => action.binding).map(action => {
    const { keys, ...options } = action.binding
    // Legacy native arrows with retained selection do nothing in hand, draw
    // and highlight; Space+Arrow continues to belong to camera panning.
    return binding(`action-${action.id}`, keys, { ...options, group: 'action', action: action.id, ...(action.id.startsWith('nudge-') && { when: state => notPanning(state) && state.toolId === 'select' }) })
  }),
])
const byId = new Map(canvasShortcutBindings.map(value => [value.id, value]))

export function matchesCanvasShortcut(id, input, context) {
  const value = byId.get(id)
  if (!value) throw new Error(`未知画布快捷键：${id}`)
  return matches(value, input, context)
}
export function findCanvasShortcut(group, input, context) {
  return canvasShortcutBindings.find(value => value.group === group && matches(value, input, context)) || null
}
export function matchingCanvasShortcuts(input, context) {
  return canvasShortcutBindings.filter(value => matches(value, input, context))
}
function matches(value, input, context) {
  if (!['key_down', 'key_up'].includes(input.type) || value.phase !== 'both' && input.type !== `key_${value.phase}`) return false
  if (value.except?.(input) || context && value.when && !value.when(context)) return false
  for (const [field, actual] of [['mod', Boolean(input.metaKey || input.ctrlKey)], ['alt', Boolean(input.altKey)], ['shift', Boolean(input.shiftKey)], ['repeat', Boolean(input.repeat)]]) {
    if (value[field] !== undefined && value[field] !== actual) return false
  }
  if (value.codeAlias && input.code === value.codeAlias || value.keyPrefix && input.key.startsWith(value.keyPrefix)) return true
  if (value.alt === true && input.code) return value.codes?.includes(input.code) || false
  return value.keys.includes(value.exact ? input.key : input.key.toLowerCase())
}
