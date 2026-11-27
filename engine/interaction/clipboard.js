import { CanvasEditError } from '../errors.js'
import { createClipboardContent } from '../clipboard/content.js'
import { encodeClipboardContent, decodeClipboardContent } from '../clipboard/format.js'
import { planClipboardPaste } from '../clipboard/placement.js'
import { validateClipboardContent } from '../clipboard/validate.js'
import { screenToCanvas } from '../../renderer/geometry.js'
import { matchesCanvasShortcut } from './shortcuts.js'

const unavailable = reason => ({ status: 'unavailable', reason })

function noticeData(value) {
  if (value == null) return null
  if (value.source !== 'clipboard' || typeof value.message !== 'string' || value.message.length > 512 || !value.counts || typeof value.counts !== 'object' || Array.isArray(value.counts)) throw new CanvasEditError('外部剪贴板通知无效。')
  const entries = Object.entries(value.counts)
  if (entries.length > 16 || entries.some(([key, count]) => !/^[a-zA-Z]{1,32}$/.test(key) || ['constructor', 'prototype'].includes(key) || !Number.isSafeInteger(count) || count < 0 || count > 100000)) throw new CanvasEditError('外部剪贴板通知计数无效。')
  return Object.freeze({ source: 'clipboard', message: value.message, counts: Object.freeze(Object.fromEntries(entries)) })
}

// The port carries ordinary formats/content only. No event, clipboard API or
// filesystem enters the editing layer. Pending IO never opens a preview gesture.
export function createClipboardActions({ session, read, change, report, boardId }, port) {
  let pending = null, disposed = false, point = null
  function reason({ own = false, menu = false } = {}) {
    const state = read(), runtime = session.state.get()
    if (disposed) return 'disposed'
    if (pending && !own) return 'clipboard-busy'
    if (runtime.isSubmitting) return 'submitting'
    if (!menu && state.inputContext.owner !== 'canvas' || state.inputContext.isComposing || state.textEditing || state.imageAltEditing || state.embedEditing) return 'input-context'
    if (state.croppingId) return 'cropping'
    if (runtime.isGestureActive || state.mode !== 'idle' || state.temporaryTool) return 'pointer-gesture'
    return null
  }
  function cancel() { if (pending) pending.cancelled = true }
  function check(token) {
    if (token.cancelled || reason({ own: true }) || session.state.get().revision !== token.revision || JSON.stringify(read().selectedIds) !== token.selection) throw new CanvasEditError('剪贴板操作期间会话、输入归属或画板已变化。', 'conflict')
  }
  function run(action, ids) {
    const blocked = reason()
    if (blocked) return unavailable(blocked)
    change({ lastError: null, lastNotice: null })
    if (action === 'paste-at-cursor') { change({ pasteAtCursor: !read().pasteAtCursor }); return { status: 'preference' } }
    if (!port || typeof port[action === 'paste' ? 'read' : 'write'] !== 'function') return unavailable('unsupported')
    const token = { revision: session.state.get().revision, selection: JSON.stringify(read().selectedIds), cancelled: false }
    const state = read(), screenPoint = point || { x: state.viewport.w / 2, y: state.viewport.h / 2 }
    const worldPoint = screenToCanvas(screenPoint, state.camera)
    const viewport = { x: -state.camera.x, y: -state.camera.y, w: state.viewport.w / state.camera.z, h: state.viewport.h / state.camera.z }
    pending = token; change({ clipboardBusy: true, lastError: null })
    return (async () => {
      try {
        if (action !== 'paste') {
          const snapshot = structuredClone(session.store.getStoreSnapshot())
          const content = port.copyContent ? await port.copyContent({ snapshot, ids, expectedRevision: token.revision, boardId }) : createClipboardContent(snapshot, ids, { boardId })
          check(token)
          await port.write(encodeClipboardContent(content))
          check(token)
          if (action === 'copy') return { status: 'copied' }
          const reply = await session.commitCommands([{ type: 'delete', ids }], { expectedRevision: token.revision })
          if (!disposed) change({ selectedIds: [], lastError: null })
          return { status: 'applied', reply }
        }
        const formats = await port.read()
        check(token)
        const external = formats?.kind === 'external-content'
        const notice = external ? noticeData(formats.notice) : null
        if (external && !['default', 'viewport-page'].includes(formats.placement)) throw new CanvasEditError('外部剪贴板落点策略无效。')
        if (external && formats.content === null) {
          change({ lastNotice: notice || noticeData({ source: 'clipboard', message: '没有可导入的内容', counts: {} }) })
          return { status: 'empty' }
        }
        const content = external ? validateClipboardContent(formats.content) : decodeClipboardContent(formats)
        if (!content) return unavailable('external-content')
        const snapshot = structuredClone(session.store.getStoreSnapshot())
        const plan = planClipboardPaste(snapshot, content, { strategy: external ? formats.placement : 'default', boardId, viewport, point: worldPoint, atCursor: state.pasteAtCursor, selectedIds: state.selectedIds, focusedGroupId: state.focusedGroupId === Object.values(snapshot.store).find(r => r.typeName === 'page')?.id ? null : state.focusedGroupId })
        const reply = await session.commitCommands([{ type: 'paste_content', content, ...plan }], { expectedRevision: token.revision })
        if (!disposed) change({ selectedIds: reply.results[0].rootIds, selectionRotation: null, lastError: null, lastNotice: notice })
        return { status: 'applied', reply }
      } catch (error) { if (!disposed) report(error); throw error }
      finally { if (pending === token) { pending = null; if (!disposed) change({ clipboardBusy: false }) } }
    })()
  }
  return {
    run, reason, cancel,
    fileTarget() {
      const blocked = reason()
      if (blocked) return unavailable(blocked)
      const state = read(), center = { x: state.viewport.w / 2, y: state.viewport.h / 2 }
      return Object.freeze({ status: 'available', point: Object.freeze({ ...(state.pasteAtCursor && point || center) }) })
    },
    availability(action) {
      // Menu controls focus the canvas before invoking an action. Describing
      // them must not disable a button merely because it holds native focus.
      return reason({ menu: true }) || (action !== 'paste-at-cursor' && typeof port?.[action === 'paste' ? 'read' : 'write'] !== 'function' ? 'unsupported' : null)
    },
    observe(input) {
      if (input.type.startsWith('pointer_') && input.point) point = { ...input.point }
      if (input.type === 'key_down' && matchesCanvasShortcut('escape-folded', input)) cancel()
    },
    dispose() { cancel(); disposed = true },
  }
}
