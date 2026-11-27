import { freezeStyles, initialStyles } from './style-definitions.js'
import { checkedStyles, planStyles } from './style-actions.js'
import { queryStyles, styleShapes } from './style-query.js'
import { findCanvasShortcut } from './shortcuts.js'

export function createStyleSession({ read, change, targets, session, report, textEditing }) {
  let disposed = false
  change({ styles: freezeStyles({ next: { ...initialStyles } }) })
  const adopt = values => { if (!disposed) change({ styles: freezeStyles({ next: { ...read().styles.next, ...values } }), lastError: null }) }
  function blocked() {
    if (session.state.get().isSubmitting) return 'submitting'
    if (read().croppingId) return 'cropping'
    if (read().textEditing) return null
    if (read().inputContext.owner === 'text-editing') return 'text-editing'
    if (read().mode !== 'idle' || session.state.get().isGestureActive) return 'pointer-gesture'
    return null
  }
  async function set(patch, ids = null) {
    const values = checkedStyles(patch)
    const reason = blocked()
    if (reason) return { status: 'unavailable', reason }
    if (!Object.keys(values).length) return { status: 'unchanged' }
    if (read().textEditing) return textEditing.applyStyles(values, ids)
    const selectedIds = [...read().selectedIds], targetIds = ids || selectedIds
    if (!targetIds.length) { adopt(values); return { status: 'session' } }
    const plan = planStyles(styleShapes(targets.records, targetIds), values, targets.isSelectable)
    // Unsupported keys do not silently become defaults for an unrelated tool.
    if (!plan.commands.length) { adopt(plan.adopted); return { status: 'unchanged' } }
    let ownsGesture = false
    try {
      session.beginGesture(); ownsGesture = true
      session.preview(plan.commands)
      const reply = await session.commitGesture()
      adopt(plan.adopted)
      return { status: 'applied', reply }
    } catch (error) {
      if (ownsGesture && session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
      if (!disposed) { change({ selectedIds }); report(error) }
      throw error
    }
  }
  return {
    get: () => queryStyles(read().styles.next, read().selectedIds, styleShapes(targets.records, read().selectedIds)),
    set,
    handle(input) {
      const binding = findCanvasShortcut('style', input)
      return binding ? { handled: true, result: set(binding.patch) } : { handled: false }
    },
    adopt,
    dispose() { disposed = true },
  }
}
