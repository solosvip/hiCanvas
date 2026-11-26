import { CanvasEditError } from '../errors.js'
import { react } from '@tldraw/state'
import { isEqual } from '@tldraw/utils'
import { captureCreationParent } from './creation-parent.js'
import { getShapeTextLayout } from '../../renderer/geometry.js'
import { textCreationProps } from './creation-presets.js'

const supported = new Set(['text', 'geo', 'arrow', 'frame'])
const contentOf = shape => shape.type === 'frame' ? shape.props.name : shape.props.richText
const propsFor = (shape, content) => shape.type === 'frame' ? { name: content } : { richText: content }
const containers = new Set(['doc', 'paragraph', 'heading', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock'])
const hasContent = node => node?.type === 'text' ? Boolean(node.text?.trim()) : !containers.has(node?.type) || (node.content || []).some(hasContent)
const styleValues = { size: ['s', 'm', 'l', 'xl'], font: ['draw', 'sans', 'serif', 'mono'], textAlign: ['start', 'middle', 'end'], align: ['start', 'middle', 'end'], verticalAlign: ['start', 'middle', 'end'] }
const styleKeys = { text: ['size', 'font', 'textAlign'], geo: ['size', 'font', 'align', 'verticalAlign'], arrow: ['size', 'font'] }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

// Content/selection flow from the view into this session. A view is seeded
// only when `epoch` changes, never from each Store preview or state update.
export function createTextEditing(context) {
  const { session, index, targets, read, change, report, prepare, inputContext } = context
  let active = null, epoch = 0
  const publish = () => change({ textEditing: active && freeze(structuredClone({ id: active.id, kind: active.kind, epoch: active.epoch, content: active.content, selection: active.selection, conflict: active.conflict, isSaving: Boolean(active.saving) })), mode: active ? 'text-editing' : 'idle' })
  const canBegin = id => supported.has(index.getRecord(id)?.type) && targets.isSelectable(id)
  function begin(id, adopt = false) {
    if (active) throw new CanvasEditError('请先结束当前文字编辑。', 'busy')
    const shape = index.getRecord(id)
    if (!canBegin(id)) return false
    if (!adopt) { prepare(); session.beginGesture() }
    active = { id, kind: shape.type, epoch: ++epoch, content: structuredClone(contentOf(shape)), original: structuredClone(contentOf(shape)), previewed: structuredClone(contentOf(shape)), revision: session.state.get().revision, selection: null, conflict: null }
    change({ selectedIds: [id] }); publish()
    inputContext({ owner: 'text-editing' })
    return true
  }
  function create(point) {
    if (active) throw new CanvasEditError('请先结束当前文字编辑。', 'busy')
    prepare()
    const id = `shape:${globalThis.crypto.randomUUID()}`, parent = captureCreationParent(context, point)
    session.beginGesture()
    session.preview([{ type: 'create_shape', id, shapeType: 'text', ...parent.pose(point), props: { ...textCreationProps, w: 1, autoSize: true } }])
    return begin(id, true)
  }
  function releaseContext() { if (read().inputContext.owner === 'text-editing') inputContext({ owner: 'canvas' }) }
  function update(content, selection = null) {
    if (!active) throw new CanvasEditError('没有进行中的文字编辑。')
    const previous = { content: active.content, selection: active.selection }
    active.content = structuredClone(content); active.selection = selection && structuredClone(selection)
    sync()
    try { if (!active.conflict) preview() }
    catch (error) { Object.assign(active, previous); throw error }
    publish()
    return true
  }
  function sync() {
    const status = session.state.get()
    if (!active || active.saving || status.isSubmitting || active.revision === status.revision) return
    active.revision = status.revision
    const shape = index.getRecord(active.id)
    if (!shape || shape.type !== active.kind) active.conflict = { type: 'deleted', revision: status.revision }
    else if (!isEqual(contentOf(shape), active.original) && (!status.isGestureActive || !isEqual(contentOf(shape), active.previewed))) active.conflict = { type: 'content', revision: status.revision, remote: structuredClone(contentOf(shape)) }
    publish()
  }
  function preview() {
    if (!session.state.get().isGestureActive) session.beginGesture()
    const shape = index.getRecord(active.id)
    session.preview([{ type: 'update', id: active.id, changes: { props: propsFor(shape, active.content) } }])
    active.previewed = structuredClone(active.content)
  }
  function changeProps(id, props) {
    if (active && active.id !== id) throw new CanvasEditError('请先结束当前文字编辑。', 'busy')
    if (active?.conflict) return false
    if (active) preview()
    else { prepare(); session.beginGesture() }
    session.preview([{ type: 'update', id, changes: { props } }])
    if (!active) return session.commitGesture()
    publish(); return true
  }
  function autoSize(id, enabled) {
    if (index.getRecord(id)?.type !== 'text' || !canBegin(id) || typeof enabled !== 'boolean') throw new CanvasEditError('自动大小需要可编辑文字和布尔选项。')
    return changeProps(id, { autoSize: enabled, ...(!enabled && { w: getShapeTextLayout(index.getRecord(id)).w }) })
  }
  function style(id, changes) {
    const keys = styleKeys[index.getRecord(id)?.type]
    if (!canBegin(id) || !keys || !changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.entries(changes).some(([key, value]) => !keys.includes(key) || !styleValues[key].includes(value))) throw new CanvasEditError('文字样式只接受适用的字号、字体和对齐选项。')
    return changeProps(id, structuredClone(changes))
  }
  function finalPreview() {
    preview()
    if (active.kind === 'text' && !hasContent(active.content)) session.preview([{ type: 'delete', ids: [active.id] }])
  }
  async function finish() {
    if (!active) return false
    const editing = active
    sync()
    if (active.conflict) return false
    try {
      // ADR0009 deliberately abandons overlapping records. Text has a longer
      // lifetime: retain the view's draft, compare only the original text,
      // then replay over the latest record with its revision, at most once.
      for (let attempt = 0; ; attempt++) {
        finalPreview()
        active.saving = true; publish()
        try {
          const result = await session.commitGesture()
          if (active !== editing) return result
          active = null; publish(); releaseContext()
          return result
        } catch (error) {
          if (active !== editing) throw error
          active.saving = false
          sync(); publish()
          if (error.code !== 'conflict' || attempt === 1) throw error
          if (active.conflict) return false
        }
      }
    } catch (error) { report(error); throw error }
  }
  function cancel() {
    if (!active) return false
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    active = null; publish(); releaseContext()
    return true
  }
  const stop = react('text editing remote revision', sync)
  return { cancel, create, canBegin, begin, finish, adopt: id => begin(id, true), dispose() { stop(); cancel() }, action(value) {
    if (value?.type === 'begin') return begin(value.id)
    if (value?.type === 'update') return update(value.content, value.selection)
    if (value?.type === 'selection') { if (!active) return false; active.selection = structuredClone(value.selection); publish(); return true }
    if (value?.type === 'auto-size') return autoSize(value.id, value.enabled)
    if (value?.type === 'style') return style(value.id, value.changes)
    if (value?.type === 'finish') return finish()
    if (value?.type === 'cancel') return cancel()
    throw new CanvasEditError('未知的文字编辑动作。')
  } }
}
