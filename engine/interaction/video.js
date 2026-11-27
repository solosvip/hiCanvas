import { screenToCanvas } from '../../renderer/geometry.js'

// Native controls report transient playback. Neither progress nor interaction
// ownership belongs to document records, history, or the transport.
export function createVideoInteraction({ session, index, targets, read, change, prepare }) {
  const assetPlayback = new Map()
  const finish = () => { if (read().interactingVideoId) change({ interactingVideoId: null }) }
  function begin(id) {
    if (session.state.get().isSubmitting || !targets.isSelectable(id) || session.store.get(id)?.type !== 'video') return false
    prepare(); change({ interactingVideoId: id, selectedIds: [id], mode: 'idle' }); return true
  }
  return {
    finish,
    applyChanges(changes) {
      let playback = read().videoPlayback
      for (const [before, after] of Object.values(changes.updated)) {
        const previous = playback[after.id]
        if (after.typeName === 'shape' && after.type === 'video' && before.props.assetId !== after.props.assetId && previous) {
          const remembered = assetPlayback.get(after.id) || new Map()
          remembered.set(previous.assetId, previous); assetPlayback.set(after.id, remembered)
          // A failed commit/undo may restore a prior source. Preserve that
          // source's progress; only a genuinely new source starts at zero.
          playback = { ...playback, [after.id]: remembered.get(after.props.assetId) || Object.freeze({ assetId: after.props.assetId, time: 0, playing: previous.playing }) }
        }
      }
      for (const id of Object.keys(changes.removed)) {
        assetPlayback.delete(id)
        for (const remembered of assetPlayback.values()) remembered.delete(id)
        if (playback[id]) { playback = { ...playback }; delete playback[id] }
      }
      if (playback !== read().videoPlayback) change({ videoPlayback: Object.freeze(playback) })
    },
    input(value) {
      if (value.type === 'finish') { finish(); return true }
      if (value.type === 'start') return begin(value.id)
      const shape = session.store.get(value.id)
      if (value.type !== 'playback' || shape?.type !== 'video' || shape.props.assetId !== value.assetId || !Number.isFinite(value.time) || value.time < 0 || typeof value.playing !== 'boolean') return false
      const previous = read().videoPlayback[value.id]
      if (previous?.assetId === value.assetId && previous.time === value.time && previous.playing === value.playing) return true
      change({ videoPlayback: Object.freeze({ ...read().videoPlayback, [value.id]: Object.freeze({ assetId: value.assetId, time: value.time, playing: value.playing }) }) })
      return true
    },
    beforeKeyboard(input) {
      if (!read().interactingVideoId) return false
      if (input.type === 'key_down' && input.key === 'Escape' && !input.isComposing) { finish(); return true }
      if (input.type === 'pointer_down') {
        const hit = index.hitsAtPoint(screenToCanvas(input.point, read().camera), 0, { geoInterior: true })[0]
        if (hit !== read().interactingVideoId) finish()
      }
      return false
    },
    handle(input) {
      const state = read()
      if (state.textEditing || state.toolId !== 'select' || state.mode !== 'pointing' || input.type !== 'pointer_up' || input.button !== 0 || input.clickCount !== 2) return false
      const raw = index.hitsAtPoint(screenToCanvas(input.point, state.camera), 4 / state.camera.z, { geoInterior: true }).find(targets.isSelectable)
      const id = raw && targets.target(raw, targets.scopeFor(raw, state.focusedGroupId))
      return begin(id)
    },
  }
}
