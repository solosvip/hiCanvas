// Input has already passed normalizeInput (#122). Keep its key / code / modifier
// contract: ordinary bindings compare lower-case key; explicit Alt bindings use
// code when present, because macOS Option+A produces key="å", code="KeyA".
// No DOM, platform sniffing or second input normalization lives here.
const binding = (id, keys, options = {}) => Object.freeze({ id, keys: Object.freeze(keys), phase: 'down', ...options })
const plain = { mod: false, alt: false, shift: false, repeat: false }
export const canvasShortcutBindings = Object.freeze([
  // Selection/navigation historically fold case; crop/tools require the
  // canonical Escape spelling. Preserve both existing normalized-input contracts.
  binding('escape', ['Escape'], { phase: 'both', exact: true }),
  binding('escape-folded', ['escape'], { phase: 'both', aliasOf: 'escape' }),
  binding('space', [' '], { phase: 'both', codeAlias: 'Space' }),
  binding('comma', [','], { phase: 'both', codeAlias: 'Comma' }),
  binding('pan-key-gate', [], { phase: 'both', keyPrefix: 'Arrow' }),
  binding('pan-direction', ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], { phase: 'both' }),
  binding('history', ['z'], { mod: true }),
  binding('selection-cycle', ['tab'], { phase: 'both', mod: false, alt: false }),
  binding('selection-enter', ['enter'], { phase: 'both', mod: false, alt: false, shift: false }),
  binding('selection-all', ['a'], { mod: true, alt: false, shift: false }),
  binding('selection-neighbor', ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], { mod: true, alt: false, shift: false }),
  binding('selection-parent', ['arrowup'], { mod: true, alt: false, shift: true }),
  binding('selection-child', ['arrowdown'], { mod: true, alt: false, shift: true }),
  binding('draw', ['d'], { ...plain, group: 'draw', tool: 'draw' }),
  binding('draw-alias', ['b', 'x'], { ...plain, shift: undefined, group: 'draw', tool: 'draw' }),
  binding('highlight', ['d'], { ...plain, shift: true, group: 'draw', tool: 'highlight' }),
  binding('create-rectangle', ['r'], { ...plain, group: 'creation', tool: 'geo', geo: 'rectangle' }),
  binding('create-ellipse', ['o'], { ...plain, group: 'creation', tool: 'geo', geo: 'ellipse' }),
  binding('create-geo', ['g'], { ...plain, group: 'creation', tool: 'geo' }),
  binding('create-frame', ['f'], { ...plain, group: 'creation', tool: 'frame' }),
  binding('create-text', ['t'], { ...plain, group: 'creation', tool: 'text' }),
  binding('create-line', ['l'], { ...plain, group: 'creation', tool: 'line' }),
  binding('create-ai-image', ['a'], { ...plain, group: 'creation', tool: 'ai-image' }),
  binding('creation-lock', ['q'], { ...plain, group: 'creation' }),
  // These inherited wildcards deliberately preserve the pre-action behavior.
  // #124's second commit will give the conflicting combinations to actions.
  binding('tool-hand', ['h'], { mod: false, alt: false, repeat: false, group: 'camera-tool', tool: 'hand' }),
  binding('tool-select', ['v'], { mod: false, alt: false, repeat: false, group: 'camera-tool', tool: 'select' }),
  binding('camera-zoom', ['=', '+', '-'], { repeat: false }),
  binding('camera-view', ['0', '1', '2'], { shift: true, repeat: false }),
  binding('zoom-hold', ['z'], { mod: false, alt: false }),
  binding('zoom-release', ['z'], { phase: 'up' }),
  binding('crop-enter', ['Enter'], { exact: true }),
])
const byId = new Map(canvasShortcutBindings.map(value => [value.id, value]))

export function matchesCanvasShortcut(id, input) {
  const value = byId.get(id)
  if (!value) throw new Error(`未知画布快捷键：${id}`)
  return matches(value, input)
}
export function findCanvasShortcut(group, input) {
  return canvasShortcutBindings.find(value => value.group === group && matches(value, input)) || null
}
function matches(value, input) {
  if (!['key_down', 'key_up'].includes(input.type) || value.phase !== 'both' && input.type !== `key_${value.phase}`) return false
  for (const [field, actual] of [['mod', Boolean(input.metaKey || input.ctrlKey)], ['alt', Boolean(input.altKey)], ['shift', Boolean(input.shiftKey)], ['repeat', Boolean(input.repeat)]]) {
    if (value[field] !== undefined && value[field] !== actual) return false
  }
  if (value.codeAlias && input.code === value.codeAlias || value.keyPrefix && input.key.startsWith(value.keyPrefix)) return true
  if (value.alt === true && input.code) return value.codes?.includes(input.code) || false
  return value.keys.includes(value.exact ? input.key : input.key.toLowerCase())
}
