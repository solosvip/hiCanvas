import { canvasActions, planCanvasAction } from '../actions/index.js'
import { CanvasEditError } from '../errors.js'
import { findCanvasShortcut, matchesCanvasShortcut } from './shortcuts.js'

const changed = diff => Object.values(diff).some(records => Object.keys(records).length)
const unavailable = reason => ({ status: 'unavailable', reason })

// The only action-to-runtime adapter. Menus and keyboard use the same planner
// and preview/commit path; held arrow keys merely extend this same transaction.
export function createSelectionActions({ session, targets, selection, duplicates, snapping, read, change, report, pageId }) {
  let held = null, disposed = false
  function context() {
    const state = read()
    return { records: targets.records, pageId, selectedIds: state.selectedIds, duplicateOffset: duplicates.offset(state.selectedIds), frame: selection.get(state.selectedIds, state.selectionRotation), canRotate: selection.canRotate(state.selectedIds), canScale: selection.capability(state.selectedIds, { mode: 'scale_shape' }).canScale }
  }
  function reason(allowHeld = false) {
    if (disposed) return 'disposed'
    if (session.state.get().isSubmitting) return 'submitting'
    if (read().inputContext.owner === 'text-editing') return 'text-editing'
    if (read().croppingId) return 'cropping'
    if (read().mode !== 'idle' || session.state.get().isGestureActive && !(allowHeld && held)) return 'pointer-gesture'
    return null
  }
  function cancel() {
    if (!held) return
    const previous = held.selectedIds; held = null
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    change({ selectedIds: previous })
  }
  function finish(plan, preview, previous) {
    if (!changed(preview.changes)) { session.cancelGesture(); return { status: 'unchanged' } }
    return session.commitGesture().then(reply => {
      const ids = plan.selectDuplicateResult ? duplicates.remember(plan.selectedIds, preview.results[0].idMap, plan.duplicateOffset) : plan.selectGroupResult ? [preview.results[0]?.groupId].filter(Boolean) : plan.selectedIds
      if (!disposed) change({ selectedIds: ids, ...(plan.resetRotation && { selectionRotation: null }), lastError: null })
      return { status: 'applied', reply }
    }).catch(error => { if (!disposed) { change({ selectedIds: previous }); report(error) }; throw error })
  }
  function run(id, options) {
    const blocked = reason()
    if (blocked) return unavailable(blocked)
    const plan = planAction(id, options)
    if (!plan.available) return unavailable(plan.reason)
    const previous = [...read().selectedIds]
    try {
      session.beginGesture()
      return finish(plan, session.preview(plan.commands), previous)
    } catch (error) {
      if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
      change({ selectedIds: previous }); report(error); throw error
    }
  }
  function planAction(id, options) {
    const plan = planCanvasAction(id, context(), options)
    // Session grid policy changes the interaction's step, never the command
    // planner's public defaults. Programmatic and held-key actions share it.
    return plan.available && id.startsWith('nudge-') ? { ...plan, commands: plan.commands.map(command => ({ ...command, delta: snapping.nudge(command.delta, options?.largeStep === true) })) } : plan
  }
  function nudge(binding, input) {
    const blocked = reason(true)
    if (blocked) return unavailable(blocked)
    if (!held && input.repeat) return unavailable('orphan-repeat')
    const plan = planAction(binding.action, { largeStep: input.shiftKey })
    if (!plan.available) return unavailable(plan.reason)
    try {
      if (!held) {
        session.beginGesture()
        held = { keys: new Set(), selectedIds: [...read().selectedIds], ids: plan.selectedIds, expected: selection.expected(plan.selectedIds) }
      }
      checkHeldBasis()
      held.keys.add(input.key.toLowerCase())
      const preview = session.preview(plan.commands)
      held.expected = selection.expected(held.ids)
      return { status: changed(preview.changes) ? 'preview' : 'unchanged' }
    } catch (error) { cancel(); report(error); throw error }
  }
  function checkHeldBasis() {
    const actual = selection.expected(held.ids)
    if (!session.state.get().isGestureActive || actual.size !== held.expected.size || [...actual].some(([id, value]) => held.expected.get(id) !== value)) throw new CanvasEditError('微移目标已被其他操作修改。', 'conflict')
  }
  function release(input) {
    if (!held?.keys.delete(input.key.toLowerCase())) return null
    if (held.keys.size) return { status: 'preview' }
    // A parent can change after the last repeated down but before keyup.
    // Validate its coordinate basis here too; another preview is not required.
    try { checkHeldBasis() } catch (error) { cancel(); report(error); throw error }
    const previous = held.selectedIds; held = null
    if (!session.state.get().isGestureActive) return unavailable('conflict')
    return session.commitGesture().then(reply => { if (!disposed) change({ lastError: null }); return { status: 'applied', reply } }).catch(error => { if (!disposed) { change({ selectedIds: previous }); report(error) }; throw error })
  }
  return {
    run, cancel,
    describe() {
      const blocked = reason(), value = context()
      return canvasActions.map(({ id, label }) => { const plan = blocked ? { available: false, reason: blocked } : planCanvasAction(id, value); return { id, label, available: plan.available, reason: plan.reason || null } })
    },
    handle(input) {
      if (input.type === 'pointer_down' || input.type === 'pointer_cancel') { cancel(); return { handled: false } }
      if (input.type === 'key_up' && held?.keys.has(input.key.toLowerCase())) return { handled: true, result: release(input) }
      if (held && input.type === 'key_down' && matchesCanvasShortcut('escape', input)) { cancel(); return { handled: true } }
      if (held && input.type === 'key_down' && matchesCanvasShortcut('space', input)) cancel()
      const binding = findCanvasShortcut('action', input, read())
      if (!binding) return { handled: false }
      if (binding.action.startsWith('nudge-')) return { handled: true, result: input.type === 'key_down' ? nudge(binding, input) : unavailable('unowned-release') }
      return { handled: true, result: run(binding.action) }
    },
    dispose() { cancel(); disposed = true },
  }
}
