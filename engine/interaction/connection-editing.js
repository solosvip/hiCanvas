import { getConnectionGeometry, screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { clamp, connectionCoordinates, constrainConnectionPoint, distance, linePoints, projectPath } from './connection-coordinates.js'
import { connectionMiddle, describeConnection } from './connection-handles.js'
import { captureBindingTargets, createTerminalBinding } from './connection-binding.js'

// A connection gesture owns only its captured records. Runtime owns the
// transaction, revision conflict and undo. No routing or label session here.
// Legacy observations used isolated native offscreen pointers and public
// getShapeHandles/record readbacks (2026-11-26): a 400px horizontal arrow's
// middle pulled down 100px stores bend=100, without moving its origin.
export function createConnectionEditing(context) {
  const { session, index, targets, read, change } = context
  let gesture = null
  function cancel() {
    const active = gesture; gesture = null
    if (!active) return
    context.snapping.clear()
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    change({ mode: 'idle', handleCursor: null, needsFrame: false })
  }
  function preview(input) {
    const g = gesture
    if (!g || input.pointerId !== g.pointerId) return
    if (!session.state.get().isGestureActive || !g.coordinates.parentsMatch() || !g.targetsMatch() || JSON.stringify(index.getRecord(g.shape.id)) !== g.expected || JSON.stringify(targets.records.bindingsFrom(g.shape.id)) !== g.bindings) throw new CanvasEditError('连接线或绑定已被其他编辑改变。', 'conflict')
    g.lastInput = input
    g.moved ||= distance(input.point, g.screen) > 4
    if (!g.moved) return
    const page = screenToCanvas(input.point, read().camera), point = g.coordinates.local(page)
    const props = {}, commands = [], handle = g.handle
    context.snapping.clear()
    if (g.shape.type === 'line') {
      const sorted = linePoints(g.shape), position = sorted.findIndex(p => p.id === handle.id)
      const origin = position > 0 ? sorted[position - 1] : sorted[1]
      const excluded = handle.kind === 'create' ? sorted.filter(p => p.index < handle.id).slice(-1).concat(sorted.filter(p => p.index > handle.id).slice(0, 1)).map(p => p.id) : sorted.filter((p, i) => Math.abs(i - position) <= 1).map(p => p.id)
      const snapped = context.snapping.controlPoint(g.shape, constrainConnectionPoint(origin, point, input.shiftKey), excluded, input, handle.kind === 'create' ? null : handle.id)
      props.points = { ...g.shape.props.points, [handle.id]: { id: handle.id, index: handle.index || g.shape.props.points[handle.id].index, ...snapped } }
    } else if (handle.kind === 'vertex') {
      const opposite = g.geometry.terminals[handle.id === 'start' ? 'end' : 'start']
      const snapped = context.snapping.controlPoint(g.shape, constrainConnectionPoint(opposite, point, input.shiftKey), [], input)
      commands.push(...g.binding.commands(g.coordinates.page(snapped), input))
      props[handle.id] = snapped
    } else if (handle.kind === 'bend') {
      const { start, end } = g.geometry.terminals, dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy) || 1
      props.bend = (g.shape.props.bend || 0) + ((point.x - g.local.x) * -dy + (point.y - g.local.y) * dx) / length
    } else if (handle.kind === 'elbow') {
      // Invert the EXISTING route at its two limit settings. Native unbound
      // m arrow dx400: moving the middle 50px gives .6356852103120759.
      // Bound routes which ignore midpoint remain unchanged.
      const at = value => connectionMiddle(getConnectionGeometry({ ...g.shape, props: { ...g.shape.props, elbowMidPoint: value } }, targets.records), 'elbow')
      const a = at(0), b = at(1), dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy
      props.elbowMidPoint = denominator ? clamp((g.shape.props.elbowMidPoint ?? .5) + ((point.x - g.local.x) * dx + (point.y - g.local.y) * dy) / denominator) : g.shape.props.elbowMidPoint
    } else props.labelPosition = clamp(projectPath(g.geometry.path, { x: g.geometry.label.center.x + point.x - g.local.x, y: g.geometry.label.center.y + point.y - g.local.y }).position)
    commands.push({ type: 'update', id: g.shape.id, changes: { props } })
    session.preview(commands)
    g.expected = JSON.stringify(index.getRecord(g.shape.id)); g.bindings = JSON.stringify(targets.records.bindingsFrom(g.shape.id))
    g.targetsMatch = captureBindingTargets(context, g.shape.id, g.targetsMatch)
    change({ mode: 'dragging', handleCursor: 'move' })
  }
  function candidate(input) {
    if (gesture) return true
    if (input.type !== 'pointer_down') return null
    const state = read(), overlay = describeConnection(context, state)
    if (!overlay || state.textEditing || state.croppingId || state.temporaryTool || input.button !== 0) return false
    const page = screenToCanvas(input.point, state.camera), radius = context.handleMetrics.cornerHit / state.camera.z
    let handle = overlay.handles.find(h => distance(h, page) <= radius)
    const shape = index.getRecord(overlay.id), coordinates = connectionCoordinates(index, shape.id), local = coordinates.local(page)
    const geometry = getConnectionGeometry(shape, targets.records), label = geometry.label?.bounds
    if (!handle && label && local.x >= label.x && local.y >= label.y && local.x <= label.x + label.w && local.y <= label.y + label.h) handle = { id: 'label', kind: 'label' }
    if (!handle) return null
    return { shape, coordinates, local, geometry, handle }
  }
  function start(input, picked) {
    if (!picked) return false
    const { shape, coordinates, local, geometry, handle } = picked
    session.beginGesture()
    gesture = { pointerId: input.pointerId, screen: input.point, local, handle, shape, geometry, coordinates, moved: false,
      expected: JSON.stringify(shape), bindings: JSON.stringify(targets.records.bindingsFrom(shape.id)),
      targetsMatch: captureBindingTargets(context, shape.id),
      binding: shape.type === 'arrow' && handle.kind === 'vertex' ? createTerminalBinding(context, shape.id, handle.id) : null }
    change({ mode: 'pointing', handleCursor: 'move' })
    return true
  }
  function up(input) {
    preview(input)
    const current = gesture; gesture = null; context.snapping.clear()
    change({ mode: 'idle', handleCursor: null })
    if (current.moved) return session.commitGesture()
    session.cancelGesture()
    if (input.clickCount !== 2 || current.shape.type !== 'arrow') return
    if (current.handle.kind === 'vertex') {
      // E22 inventory contract. Native + CDP observations entered text
      // editing instead; no reliable legacy cap-cycling positive was found.
      const key = current.handle.id === 'start' ? 'arrowheadStart' : 'arrowheadEnd'
      session.beginGesture(); session.preview([{ type: 'update', id: current.shape.id, changes: { props: { [key]: current.shape.props[key] === 'none' ? 'arrow' : 'none' } } }])
      return session.commitGesture()
    }
    return context.textEditing.begin(current.shape.id)
  }
  return { cancel, candidate, refreshSnapping:()=>{if(gesture?.lastInput)preview(gesture.lastInput)}, applyChanges: changes => gesture?.targetsMatch.apply(changes), describe: state => describeConnection(context, state),
    get needsFrame() { return Boolean(gesture?.moved && gesture.binding?.needsFrame) },
    handle(input, picked) {
      if (input.type === 'pointer_down' && !gesture) return { handled: start(input, picked) }
      if (!gesture) return { handled: false }
      if (input.type === 'key_down' && input.key === 'Escape' || input.type === 'pointer_cancel' && input.pointerId === gesture.pointerId) { cancel(); return { handled: true } }
      if (input.type === 'frame') { if (gesture.lastInput) preview({ ...gesture.lastInput, time: input.time }); return { handled: true } }
      if (input.type.startsWith('key_')) {
        if (gesture.lastInput) preview({ ...gesture.lastInput, ...Object.fromEntries(['altKey', 'ctrlKey', 'shiftKey', 'metaKey'].map(key => [key, input[key]])), time: input.time })
        return { handled: true }
      }
      if (input.type === 'pointer_move' && input.pointerId === gesture.pointerId) { preview(input); return { handled: true } }
      if (input.type === 'pointer_up' && input.pointerId === gesture.pointerId) return { handled: true, result: up(input) }
      return { handled: input.type.startsWith('pointer_') }
    },
  }
}
