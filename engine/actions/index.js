import { actionSelection, pageShapes, expandedSelection } from './selection.js'

const plain = { mod: false, alt: false, shift: false, repeat: false }
const shortcut = (keys, options = {}) => Object.freeze({ keys: Object.freeze(keys), ...plain, ...options, ...(options.codes && { codes: Object.freeze(options.codes) }) })
const altLetter = (key, shift = false) => shortcut([key], { alt: true, shift, codes: [`Key${key.toUpperCase()}`] })
const command = (type, args = {}) => context => ({ commands: [{ type, ids: context.ids, ...args }], selectedIds: context.ids })
const entry = (id, label, minimum, build, binding = null, eligible = () => true) => Object.freeze({ id, label, minimum, build, binding, eligible })
const layout = (id, label, type, args, binding = null, minimum = 2) => entry(id, label, minimum, command(type, args), binding)
const frameCenter = frame => ({ x: frame.x + frame.w / 2 * Math.cos(frame.rotation || 0) - frame.h / 2 * Math.sin(frame.rotation || 0), y: frame.y + frame.w / 2 * Math.sin(frame.rotation || 0) + frame.h / 2 * Math.cos(frame.rotation || 0) })
const rotatable = context => Boolean(context.frame && context.canRotate !== false)
const scalable = context => Boolean(context.frame && context.canScale !== false)

// 2026-11-26 legacy black-box observations: offscreen native key down/up and
// real menu clicks on synthetic shapes. Arrows move 1 world unit (also at z=2),
// Shift moves 10; real CDP autoRepeat previews 4 steps, one keyup / undo commits
// the whole hold. Rotation advances to the next 15° tick, Alt to 15°/16; scale
// is 1.1 / its reciprocal. Menu stack/pack gap=10 and frame padding=50.
// Two-selection menu has stretch/pack; stack/distribute first appear at three.
export const canvasActions = Object.freeze([
  entry('duplicate', '复制副本', 1, context => {
    const offset = context.duplicateOffset || { x: Math.abs(context.frame.w * Math.cos(context.frame.rotation || 0)) + Math.abs(context.frame.h * Math.sin(context.frame.rotation || 0)) + 10, y: 0 }
    return { commands: [{ type: 'duplicate_shapes', ids: context.ids, offset }], selectedIds: context.ids, selectDuplicateResult: true, duplicateOffset: offset }
  }, shortcut(['d'], { mod: true }), context => Boolean(context.frame)),
  ...[
    ['left', '靠左', 'a'], ['center-horizontal', '水平居中', 'h'], ['right', '靠右', 'd'],
    ['top', '靠上', 'w'], ['center-vertical', '垂直居中', 'v'], ['bottom', '靠下', 's'],
  ].map(([alignment, label, key]) => layout(`align-${alignment}`, label, 'align_shapes', { alignment }, altLetter(key))),
  ...['x', 'y'].flatMap(axis => [
    layout(`stretch-${axis}`, `${axis === 'x' ? '水平' : '垂直'}拉伸`, 'stretch_shapes', { axis }),
    layout(`distribute-${axis}`, `${axis === 'x' ? '水平' : '垂直'}分布`, 'distribute_shapes', { axis }, altLetter(axis === 'x' ? 'h' : 'v', true), 3),
    layout(`stack-${axis}`, `${axis === 'x' ? '水平' : '垂直'}堆排`, 'stack_shapes', { axis, gap: 10 }, null, 3),
    layout(`flip-${axis}`, `${axis === 'x' ? '水平' : '垂直'}镜像`, 'flip_shapes', { axis }, shortcut([axis === 'x' ? 'h' : 'v'], { shift: true }), 1),
  ]),
  layout('pack', '紧凑排布', 'pack_shapes', { gap: 10 }),
  ...['front', 'forward', 'backward', 'back'].map(operation => entry(`reorder-${operation}`, { front: '置顶', forward: '前移一层', backward: '后移一层', back: '置底' }[operation], 1,
    command('reorder_shapes', { operation, ...(['forward', 'backward'].includes(operation) && { mode: 'overlapping' }) }),
    shortcut([['front', 'forward'].includes(operation) ? ']' : '['], { alt: ['forward', 'backward'].includes(operation), codes: [['front', 'forward'].includes(operation) ? 'BracketRight' : 'BracketLeft'] }))),
  ...[1, -1].flatMap(direction => [false, true].map(fine => entry(`rotate-${direction === 1 ? 'clockwise' : 'counterclockwise'}${fine ? '-fine' : ''}`, `${direction === 1 ? '顺' : '逆'}时针${fine ? '细转' : '旋转'}`, 1,
    context => ({ commands: [{ type: 'rotate_shapes', ids: context.ids, origin: frameCenter(context.frame), step: Math.PI / (fine ? 192 : 12), direction, referenceAngle: context.frame.rotation || 0 }], selectedIds: context.ids, resetRotation: true }),
    shortcut(direction === 1 ? ['.', '>'] : [',', '<'], { shift: true, alt: fine, codes: [direction === 1 ? 'Period' : 'Comma'] }), rotatable))),
  ...[true, false].map(enlarge => entry(enlarge ? 'enlarge' : 'shrink', enlarge ? '放大对象' : '缩小对象', 1,
    context => ({ commands: [{ type: 'scale_shapes', ids: context.ids, origin: frameCenter(context.frame), scale: { x: enlarge ? 1.1 : 1 / 1.1, y: enlarge ? 1.1 : 1 / 1.1 } }], selectedIds: context.ids }),
    shortcut(enlarge ? ['=', '+'] : ['-', '_'], { mod: true, alt: true, shift: true, codes: [enlarge ? 'Equal' : 'Minus'] }), scalable)),
  entry('group', '组合／解组', 1, context => context.shapes.length === 1 && context.shapes[0].type === 'group'
    ? { commands: [{ type: 'ungroup_shapes', ids: context.ids }], selectedIds: expandedSelection(context.records, context.shapes, 'group') }
    : { commands: [{ type: 'group_shapes', ids: context.ids }], selectGroupResult: true }, shortcut(['g'], { mod: true }), context => context.shapes.length >= 2 || context.shapes[0]?.type === 'group'),
  entry('ungroup', '解组', 1, context => ({ commands: [{ type: 'ungroup_shapes', ids: context.shapes.filter(r => r.type === 'group').map(r => r.id) }], selectedIds: expandedSelection(context.records, context.shapes, 'group') }), shortcut(['g'], { mod: true, shift: true }), context => context.shapes.some(r => r.type === 'group')),
  Object.freeze({ ...entry('toggle-lock', '锁定／解锁', 1, context => ({ ...command('toggle_lock')(context), selectedIds: context.shapes.every(r => r.isLocked) ? context.ids : [] }), shortcut(['l'], { shift: true })), allowLocked: true }),
  entry('unlock-all', '全部解锁', 0, context => ({ commands: [{ type: 'unlock_all' }], selectedIds: context.ids }), null, context => pageShapes(context.records, context.pageId).some(r => r.isLocked)),
  entry('delete', '删除', 1, context => ({ commands: [{ type: 'delete', ids: context.ids }], selectedIds: [] }), shortcut(['backspace', 'delete'])),
  entry('fit-frame', '画框适配内容', 1, command('fit_frame_to_content', { padding: 50 }), null, context => context.shapes.every(r => r.type === 'frame')),
  entry('remove-frame', '移除画框', 1, context => ({ commands: [{ type: 'remove_frames', ids: context.shapes.filter(r => r.type === 'frame').map(r => r.id) }], selectedIds: expandedSelection(context.records, context.shapes, 'frame') }), shortcut(['f'], { mod: true, shift: true }), context => context.shapes.some(r => r.type === 'frame')),
  ...[['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]].map(([direction, x, y]) => entry(`nudge-${direction}`, `向${{ left: '左', right: '右', up: '上', down: '下' }[direction]}微移`, 1,
    context => command('nudge_shapes', { delta: { x: x * (context.largeStep ? 10 : 1), y: y * (context.largeStep ? 10 : 1) } })(context), shortcut([`arrow${direction}`], { alt: undefined, shift: undefined, repeat: undefined, phase: 'both' }))),
])
const byId = new Map(canvasActions.map(action => [action.id, action]))

// context = { records:{getRecord,childIds}, pageId, selectedIds, frame?,
// canRotate?, canScale? }. Callers supply the already computed selection frame.
// Planning never writes records, generates IDs, or opens a transaction.
export function planCanvasAction(id, context, options = {}) {
  const action = byId.get(id)
  if (!action) return { available: false, reason: 'unknown-action' }
  const shapes = actionSelection(context, action.allowLocked), value = { ...context, largeStep: options?.largeStep === true, shapes, ids: shapes.map(r => r.id) }
  if (shapes.length < action.minimum || !action.eligible(value)) return { available: false, reason: 'unavailable' }
  return { available: true, id, ...action.build(value) }
}
