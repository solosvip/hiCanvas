import { captureRecordBasis, assertRecordBasis } from '../record-basis.js'
import { getRecordDependencies } from '../record-dependencies.js'
import { atom } from '@tldraw/state'
import { getShapeBounds, shapeToPagePoint, pageToShapePoint } from '../../renderer/geometry.js'
import { checkedShapeLink, supportsShapeLink } from '../shape-links.js'
import { CanvasEditError } from '../errors.js'
import { canvasOwnsFocus } from './keyboard-input.js'

function draftUrl(value) {
  // Bare hosts are a UI convenience. Commands and saved descriptors continue
  // to require full HTTP(S) URLs; relative URLs and explicit schemes never gain one.
  const text = value.trim()
  // Keep the original surrounding bytes so the public validator still rejects
  // control characters and enforces its byte budget before trimming spaces.
  return checkedShapeLink(text && !/^[a-z][a-z\d+.-]*:/i.test(text) && !text.startsWith('/') ? value.replace(text, () => `https://${text}`) : value)
}

export function createShapeLinkEditing({ session, targets, initial, pageId, read, change, report, prepare }) {
  const generation = atom('shape link records', 0)
  const ids = new Set(initial.filter(supportsShapeLink).map(shape => shape.id))
  let basis = null, pending = null, disposed = false, cacheKey = null, cachedItems = Object.freeze([])
  function blocked() {
    const s = read(), runtime = session.state.get()
    return disposed || runtime.isSubmitting || runtime.isGestureActive || s.mode !== 'idle' || s.temporaryTool || s.clipboardBusy || s.textEditing || s.imageAltEditing || s.croppingId || s.embedEditing || s.aiFrameSizeEditing || s.inputContext.isComposing
  }
  const target = () => read().selectedIds.length === 1 && targets.isSelectable(read().selectedIds[0]) && supportsShapeLink(session.store.get(read().selectedIds[0])) ? session.store.get(read().selectedIds[0]) : null
  function available() { return !blocked() && !read().linkEditing && canvasOwnsFocus(read().inputContext) && Boolean(target()) }
  function cancel() { basis = null; if (!disposed) change({ linkEditing: null }) }
  function update(url) {
    if (typeof url !== 'string' || url.length > 8192) throw new CanvasEditError('网址超过大小上限。')
    let valid = true, message = null
    try { draftUrl(url) } catch (error) { valid = false; message = error.message }
    change({ linkEditing: Object.freeze({ id: basis.id, url, valid, message }) })
  }
  async function submit(clear = false) {
    if (pending) return pending
    const expected = basis, value = read().linkEditing
    if (!expected || !value) throw new CanvasEditError('请先选择对象并打开编辑链接。')
    try {
      const shape = target(), state = read()
      if (blocked() || !shape || shape.id !== expected.id || shape.props.url !== expected.url ||
        state.toolId !== expected.toolId) throw new CanvasEditError('对象、权限、选区或工具已变化；草稿已保留，请重新打开。', 'conflict')
      const url = clear ? '' : draftUrl(value.url)
      const commands = [{ type: 'set_shape_link', id: expected.id, url }], snapshot = session.store.getStoreSnapshot()
      assertRecordBasis(snapshot, expected.recordBasis, getRecordDependencies(snapshot, commands))
      let previous = null
      try { previous = checkedShapeLink(shape.props.url) } catch { /* Invalid historical URL may be repaired. */ }
      if (url === previous) { cancel(); return null }
      pending = session.commitCommands(commands, { recordBasis: expected.recordBasis })
      const reply = await pending
      if (!disposed && basis === expected) { cancel(); change({ lastError: null }) }
      return reply
    } catch (error) { if (!disposed && basis === expected) report(error); throw error }
    finally { pending = null }
  }
  function items() {
    const key = `${generation.get()}:${JSON.stringify(read().selectedIds)}`
    if (key === cacheKey) return cachedItems
    const selected = new Set(read().selectedIds), result = []
    for (const id of ids) {
      const chain = targets.lineage(id), shape = chain[0]
      if (!supportsShapeLink(shape) || chain.at(-1).parentId !== pageId || chain.some(r => r.opacity === 0)) continue
      let url
      try { url = checkedShapeLink(shape.props.url) } catch { continue }
      if (!url) continue
      const snapshot = { store: Object.fromEntries(chain.map(r => [r.id, r])) }, bounds = getShapeBounds(shape)
      if (!bounds || bounds.w <= 0 || bounds.h <= 0) continue
      const clips = chain.slice(1).filter(r => r.type === 'frame').map(frame => {
        const box = getShapeBounds(frame)
        return [{ x: 0, y: 0 }, { x: box.w, y: 0 }, { x: box.w, y: box.h }, { x: 0, y: box.h }]
          .map(p => Object.freeze(pageToShapePoint(snapshot, id, shapeToPagePoint(snapshot, frame.id, p))))
      })
      result.push(Object.freeze({ id, url, bounds: Object.freeze({ ...bounds }), origin: Object.freeze(shapeToPagePoint(snapshot, id, { x: 0, y: 0 })),
        rotation: chain.reduce((angle, r) => angle + r.rotation, 0), opacity: chain.reduce((alpha, r) => alpha * r.opacity, 1), selected: selected.has(id),
        clips: Object.freeze(clips.map(p => Object.freeze(p))), order: chain.toReversed().map(r => r.index).join('/') }))
    }
    result.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    cacheKey = key; cachedItems = Object.freeze(result)
    return cachedItems
  }
  return {
    cancel,
    get: () => Object.freeze({ canEdit: available(), items: items() }),
    applyChanges(changes) {
      for (const shape of Object.values(changes.added)) if (supportsShapeLink(shape)) ids.add(shape.id)
      for (const [before, after] of Object.values(changes.updated)) { if (supportsShapeLink(after)) ids.add(after.id); else ids.delete(before.id) }
      for (const id of Object.keys(changes.removed)) ids.delete(id)
      generation.set(generation.get() + 1)
    },
    action(value) {
      if (value?.type === 'cancel') { cancel(); return true }
      if (value?.type === 'submit' || value?.type === 'clear') return submit(value.type === 'clear')
      if (value?.type === 'open') {
        if (pending || !available()) throw new CanvasEditError('请选择一个可以编辑链接的未锁定对象。')
        prepare()
        const shape = target()
        const snapshot = session.store.getStoreSnapshot()
        basis = { id: shape.id, url: shape.props.url, recordBasis: captureRecordBasis(snapshot, getRecordDependencies(snapshot, [{ type: 'set_shape_link', id: shape.id }])), toolId: read().toolId }
        change({ lastError: null }); update(shape.props.url); return true
      }
      if (value?.type === 'update' && basis && read().linkEditing && !pending) { update(value.url); return true }
      throw new CanvasEditError('未知链接操作或对话框已关闭。')
    },
    beforeKeyboard(input) {
      if (!read().linkEditing || input.type !== 'key_down' || input.isComposing || input.keyCode === 229 || read().inputContext.isComposing) return { handled: false }
      if (input.key === 'Escape') { cancel(); return { handled: true } }
      return { handled: false } // Native form owns Enter and its focused button.
    },
    dispose() { cancel(); disposed = true; ids.clear(); cachedItems = Object.freeze([]) },
  }
}
