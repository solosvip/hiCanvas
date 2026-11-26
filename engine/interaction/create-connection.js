import { getIndexAbove } from '@tldraw/utils'
import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { captureCreationParent } from './creation-parent.js'
import { connectionCoordinates, constrainConnectionPoint, distance, linePoints } from './connection-coordinates.js'
import { captureBindingTargets, createTerminalBinding } from './connection-binding.js'

export const createArrowTool = context => createConnectionTool(context, 'arrow')
export const createLineTool = context => createConnectionTool(context, 'line')

function createConnectionTool(context, type) {
  const { session, index, read, change, report } = context
  let gesture = null, source = context.creation.takeSource(type), continuation = null
  function cancel() {
    const current = gesture; gesture = null
    if (current && session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    if (current) change({ mode: 'idle', selectedIds: current.before, needsFrame: false })
    source = 'canvas'; context.creation.endToolbar()
  }
  function preview(input) {
    const g = gesture
    if (!g || input.pointerId !== g.pointerId) return
    if (!session.state.get().isGestureActive || !g.targetsMatch() || g.parent && !g.parent.matches() || g.coordinates && !g.coordinates.parentsMatch() || g.expected && JSON.stringify(index.getRecord(g.id)) !== g.expected || g.bindings !== JSON.stringify(context.targets.records.bindingsFrom(g.id))) throw new CanvasEditError('连接线创建或父级已被其他编辑改变。', 'conflict')
    g.lastInput = input; g.moved ||= distance(input.point, g.screen) > 4
    const page = screenToCanvas(input.point, read().camera)
    let point = g.coordinates ? g.coordinates.local(page) : { x: page.x - g.point.x, y: page.y - g.point.y }
    point = constrainConnectionPoint(g.origin, point, input.shiftKey && !g.continuing)
    if (!g.moved && !g.continuing) point = { x: .1, y: .1 }
    const props = type === 'line' ? { points: { ...g.points, [g.endId]: { id: g.endId, index: g.endId, ...point } } } : { end: point }
    const commands = [g.expected ? { type: 'update', id: g.id, changes: { props } } : {
      // Native tools.more.arrow drag record, 2026-11-26: draw dash/font,
      // local start zero and end at the pointer delta.
      type: 'create_shape', id: g.id, shapeType: type, ...g.parent.pose(g.point), props: { dash: 'draw', font: 'draw', ...props },
    }]
    // The line schema has no font; arrow uses the legacy drawing font.
    if (!g.expected && type === 'line') delete commands[0].props.font
    if (type === 'arrow') {
      if (!g.expected) {
        // First create the record so candidate filtering can see its ancestry.
        session.preview(commands.splice(0))
        commands.push(...g.startBinding.commands(g.point, g.startInput))
      }
      commands.push(...g.endBinding.commands({ x: g.point.x + point.x, y: g.point.y + point.y }, input))
    }
    if (commands.length) session.preview(commands)
    g.expected = JSON.stringify(index.getRecord(g.id)); g.bindings = JSON.stringify(context.targets.records.bindingsFrom(g.id))
    g.targetsMatch = captureBindingTargets(context, g.id, g.targetsMatch)
    change({ selectedIds: [g.id], mode: g.moved ? 'dragging' : 'pointing' })
  }
  function down(input) {
    if (input.button !== 0 || gesture) return
    const last = continuation && index.getRecord(continuation.id), continuing = type === 'line' && input.shiftKey && last?.type === 'line' && context.targets.isSelectable(last.id)
    const point = screenToCanvas(input.point, read().camera), parent = continuing ? null : captureCreationParent(context, source === 'toolbar' ? null : point)
    const coordinates = continuing ? connectionCoordinates(index, last.id) : null
    const points = continuing ? linePoints(last) : []
    // Native Shift-click samples 3–32px from the last point all appended.
    // Only the initial tiny click seed is replaced, without its .1px drift.
    const replace = continuing && continuation.seed
    const origin = continuing ? points.at(replace ? -2 : -1) : { x: 0, y: 0 }, endId = continuing ? replace ? points.at(-1).id : getIndexAbove(points.at(-1).index) : 'a2'
    const id = continuing ? last.id : `shape:${globalThis.crypto.randomUUID()}`
    session.beginGesture()
    gesture = { id, pointerId: input.pointerId, point, screen: input.point, before: [...read().selectedIds], parent, coordinates, continuing, origin, endId,
      points: continuing ? last.props.points : { a1: { id: 'a1', index: 'a1', x: 0, y: 0 } },
      moved: false, expected: continuing ? JSON.stringify(last) : null, bindings: JSON.stringify(context.targets.records.bindingsFrom(id)),
      targetsMatch: captureBindingTargets(context, id),
      startBinding: type === 'arrow' && createTerminalBinding(context, id, 'start'), endBinding: type === 'arrow' && createTerminalBinding(context, id, 'end'), startInput: input,
      generation: context.creation.generation() }
    preview(input)
  }
  function up(input) {
    preview(input)
    const current = gesture
    // Native arrow clicks leave no record and keep the tool ready.
    if (type === 'arrow' && !current.moved) return cancel()
    if (source === 'toolbar' && (!current.moved || input.point.x < 0 || input.point.y < 0 || input.point.x >= read().viewport.w || input.point.y >= read().viewport.h)) return cancel()
    gesture = null; source = 'canvas'; context.creation.endToolbar()
    change({ mode: 'idle' })
    return session.commitGesture().then(result => {
      continuation = type === 'line' ? { id: current.id, seed: !current.continuing && !current.moved } : null
      if (current.generation === context.creation.generation() && !read().creation.toolLocked && (type !== 'line' || current.moved && !current.continuing)) context.returnToSelect()
      return result
    }).catch(error => { if (current.generation === context.creation.generation()) change({ selectedIds: current.before }); report(error); throw error })
  }
  return { cancel, applyChanges: changes => gesture?.targetsMatch.apply(changes), get needsFrame() { return Boolean(gesture?.moved && gesture.endBinding?.needsFrame) },
    frame(time) { if (gesture?.lastInput) preview({ ...gesture.lastInput, time }) }, dispatch(input) {
    if (input.type === 'pointer_down') return down(input)
    if (input.type === 'pointer_move') return preview(input)
    if (input.type === 'pointer_up' && input.pointerId === gesture?.pointerId) return up(input)
    if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId || input.type === 'key_down' && input.key === 'Escape') { const idle = !gesture; cancel(); if (idle) context.returnToSelect() }
    else if ((input.type.startsWith('key_') || input.type === 'frame') && gesture?.lastInput) preview({ ...gesture.lastInput, time: input.time, ...(input.type.startsWith('key_') && { shiftKey: input.shiftKey, altKey: input.altKey, ctrlKey: input.ctrlKey, metaKey: input.metaKey }) })
  } }
}
