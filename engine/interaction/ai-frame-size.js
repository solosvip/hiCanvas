import { CanvasEditError } from '../errors.js'

const presets = Object.freeze([
  ['1:1', 512, 512], ['3:2', 768, 512], ['2:3', 512, 768],
  ['4:3', 683, 512], ['3:4', 512, 683], ['16:9', 1024, 576], ['9:16', 512, 910],
].map(([id, w, h]) => Object.freeze({ id, w, h, ratio: w / h })))

const clamp = n => Math.max(16, Math.min(16384, Math.round(n)))
function dimensions(patch, draft, shape) {
  const keys = ['w', 'h'].filter(k => Object.hasOwn(patch, k))
  if (!keys.length || keys.some(k => typeof patch[k] !== 'number' || !Number.isFinite(patch[k]) || patch[k] <= 0)) throw new CanvasEditError('宽高需要有限正数。')
  let { w, h } = draft
  if (shape.meta.cowartAiAspectLocked !== true) return { w: keys.includes('w') ? clamp(patch.w) : w, h: keys.includes('h') ? clamp(patch.h) : h }
  const ratio = shape.meta.cowartAiAspectRatio
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 16 / 16384 || ratio > 16384 / 16) throw new CanvasEditError('先解除比例锁定再改尺寸')
  if (keys.includes('w')) {
    w = clamp(patch.w); h = Math.round(w / ratio)
    if (h < 16 || h > 16384) { h = clamp(h); w = Math.round(h * ratio) }
  } else {
    h = clamp(patch.h); w = Math.round(h * ratio)
    if (w < 16 || w > 16384) { w = clamp(w); h = Math.round(w / ratio) }
  }
  return { w, h }
}

export function createAiFrameSize({ session, read, targets, selection, change, report }) {
  let active = null, pending = null, disposed = false
  function blocked(state) {
    if (session.state.get().isSubmitting) return 'submitting'
    if (state.textEditing || state.inputContext.owner === 'text-editing') return 'text-editing'
    if (state.croppingId) return 'cropping'
    if (state.imageAltEditing || state.interactingVideoId) return 'other-editing'
    if (state.mode !== 'idle' || session.state.get().isGestureActive) return 'pointer-gesture'
    if (state.toolId !== 'select') return 'tool'
    return null
  }
  function describe() {
    const state = read(), ids = state.selectedIds, shape = ids.length === 1 && session.store.get(ids[0])
    const kind = shape?.type === 'frame' && !shape.meta.cowartAiSlides && (shape.meta.cowartAiFilmHolder ? 'film' : shape.meta.cowartAiDraftHolder ? 'draft' : shape.meta.cowartAiImageHolder ? 'image' : null)
    const reason = ids.length !== 1 ? 'single-selection' : !kind ? 'unsupported' : !targets.isSelectable(shape.id) ? 'not-editable' : blocked(state)
    const draft = active?.id === shape?.id ? active : null
    const storedRatio = kind && (shape.meta.cowartAiAspectRatio ?? shape.props.w / shape.props.h)
    const ratio = typeof storedRatio === 'number' && Number.isFinite(storedRatio) && storedRatio > 0 ? storedRatio : null
    return Object.freeze({ available: !reason, reason, presets, ...(kind && { id: shape.id, kind, w: draft?.w ?? shape.props.w, h: draft?.h ?? shape.props.h, locked: shape.meta.cowartAiAspectLocked === true, ratio, editing: Boolean(draft) }) })
  }
  function valid(state) {
    return state.selectedIds.length === 1 && state.selectedIds[0] === active.id && state.toolId === 'select' && targets.isSelectable(active.id) && [...active.basis].every(([id, record]) => JSON.stringify(session.store.get(id)) === record)
  }
  function sync(state) {
    if (active && !pending && !valid(state)) active = null
    return active ? Object.freeze({ id: active.id, w: active.w, h: active.h }) : null
  }
  function cancel() { if (pending) throw new CanvasEditError('尺寸正在提交。', 'busy'); active = null; if (!disposed) change() }
  function save(shape, props, meta, draft = null) {
    const changed = Object.entries(props).some(([k, v]) => shape.props[k] !== v) || Object.entries(meta).some(([k, v]) => shape.meta[k] !== v)
    if (!changed) { if (draft) cancel(); change({ lastError: null }); return { status: 'unchanged' } }
    // Like image-alt, field drafts stay outside Store. This single semantic
    // commit deliberately does not replay a 409 against a newly locked parent.
    pending = session.commitCommands([{ type: 'update', id: shape.id, changes: { props, meta } }]).then(reply => {
      if (active === draft) active = null
      if (!disposed) change({ lastError: null })
      return { status: 'applied', reply }
    }).finally(() => { pending = null; if (!disposed) change() })
    return pending
  }
  async function action(value) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanvasEditError('AI 框尺寸操作需要对象。')
      const fields = { start: ['type'], update: ['type', 'w', 'h'], finish: ['type'], cancel: ['type'], preset: ['type', 'preset'], lock: ['type', 'locked'] }[value.type]
      if (!Array.isArray(fields) || Object.keys(value).some(k => !fields.includes(k))) throw new CanvasEditError('未知 AI 框尺寸操作或字段。')
      if (value.type === 'finish' && pending) return await pending
      if (pending) throw new CanvasEditError('尺寸正在提交。', 'busy')
      if (value.type === 'cancel') { cancel(); return { status: 'cancelled' } }
      if (blocked(read())) throw new CanvasEditError('请先结束当前操作，再修改 AI 框尺寸。', 'unavailable')
      sync(read())
      if (['finish', 'update'].includes(value.type) && !active) { change(); return { status: 'unchanged' } }
      const q = describe()
      if (!q.available) throw new CanvasEditError('请先结束当前操作，并只选择一个可编辑的 AI 图片、网页或影片框。', 'unavailable')
      const shape = session.store.get(q.id), meta = {}
      let props = {}
      if (value.type === 'start') {
        if (active) return { status: 'unchanged' }
        active = { id: shape.id, w: shape.props.w, h: shape.props.h, basis: selection.expected([shape.id]) }
        change({ lastError: null }); return { status: 'editing' }
      }
      if (value.type === 'update') {
        Object.assign(active, dimensions(value, active, shape)); change({ lastError: null }); return { status: 'editing' }
      }
      if (value.type === 'finish') return await save(shape, { w: active.w, h: active.h }, {}, active)
      if (active) throw new CanvasEditError('请先确认或取消正在编辑的尺寸。', 'busy')
      if (value?.type === 'preset') {
        const preset = presets.find(p => p.id === value.preset)
        if (!preset) throw new CanvasEditError('未知 AI 框尺寸预设。')
        props = { w: preset.w, h: preset.h }; meta.cowartAiAspectRatio = preset.ratio
      } else if (value?.type === 'lock') {
        if (typeof value.locked !== 'boolean') throw new CanvasEditError('比例锁定需要布尔值。')
        if (value.locked !== (shape.meta.cowartAiAspectLocked === true)) {
          meta.cowartAiAspectLocked = value.locked
          if (value.locked) meta.cowartAiAspectRatio = shape.props.w / shape.props.h
        }
      } else throw new CanvasEditError('未知 AI 框尺寸操作。')
      return await save(shape, props, meta)
    } catch (error) { report(error); throw error }
  }
  return { get: describe, action, sync, cancel, dispose() { active = null; disposed = true } }
}
