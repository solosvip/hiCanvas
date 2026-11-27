import { CanvasEditError } from '../errors.js'
import { react } from '@tldraw/state'
import { isEqual } from '@tldraw/utils'
import { captureCreationParent } from './creation-parent.js'
import { getShapeTextLayout } from '../../renderer/geometry.js'
import { createNoteAuthor } from './note-author.js'
import { checkedStyles, planStyles } from './style-actions.js'
import { styledCreation, styleDefinitions, supportsStyle, styleValue } from './style-definitions.js'

const supported = new Set(['text', 'geo', 'arrow', 'frame', 'note'])
const contentOf = shape => shape.type === 'frame' ? shape.props.name : shape.props.richText
const propsFor = (shape, content) => shape.type === 'frame' ? { name: content } : { richText: content }
const containers = new Set(['doc', 'paragraph', 'heading', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock'])
const hasContent = node => node?.type === 'text' ? Boolean(node.text?.trim()) : !containers.has(node?.type) || (node.content || []).some(hasContent)
const textStyleKeys = new Set(['size', 'font', 'textAlign', 'align', 'verticalAlign'])
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

// Content/selection flow from the view into this session. A view is seeded
// only when `epoch` changes, never from each Store preview or state update.
export function createTextEditing(context) {
  const { session, index, targets, read, change, report, prepare, inputContext } = context
  const noteAuthor = createNoteAuthor(context.displayName)
  let active = null, epoch = 0
  const publish = () => change({ textEditing: active && freeze(structuredClone({ id: active.id, kind: active.kind, epoch: active.epoch, content: active.content, selection: active.selection, conflict: active.conflict, isSaving: Boolean(active.saving) })), mode: active ? 'text-editing' : 'idle' })
  const canBegin = id => supported.has(index.getRecord(id)?.type) && targets.isSelectable(id)
  function canContinue() {
    const chain = targets.lineage(active.id)
    // A zero-opacity preview belongs to this edit. It may be restored without
    // relaxing locks or visibility on an ancestor or another object.
    return Boolean(chain.length && chain.at(-1).parentId === targets.pageId && chain.every(record => !record.isLocked && (record.opacity !== 0 || record.id === active.id && active.previewedOpacity === 0)))
  }
  function begin(id, adopt = false) {
    if (active) throw new CanvasEditError('请先结束当前文字编辑。', 'busy')
    const shape = index.getRecord(id)
    // Only the creation hand-off may edit its own zero-opacity preview. Saved
    // hidden shapes and invisible/locked ancestors retain normal access rules.
    const chain = adopt && shape?.opacity === 0 && session.state.get().isGestureActive && targets.lineage(id)
    const hiddenCreation = chain && chain.at(-1)?.parentId === targets.pageId && chain.every(record => !record.isLocked && (record.opacity !== 0 || record.id === id))
    if (!canBegin(id) && !(hiddenCreation && supported.has(shape.type))) return false
    if (!adopt) { prepare(); session.beginGesture() }
    active = { id, kind: shape.type, epoch: ++epoch, content: structuredClone(contentOf(shape)), original: structuredClone(contentOf(shape)), previewed: structuredClone(contentOf(shape)), originalAuthor: shape.props.textFirstEditedBy ?? null, previewedAuthor: shape.props.textFirstEditedBy ?? null, revision: session.state.get().revision, authorExisted: session.store.has(noteAuthor.recordId), selection: null, conflict: null, styles: {}, originalStyles: {}, previewedOpacity: shape.opacity }
    change({ selectedIds: [id] }); publish()
    inputContext({ owner: 'text-editing' })
    return true
  }
  function create(point) {
    if (active) throw new CanvasEditError('请先结束当前文字编辑。', 'busy')
    prepare()
    const id = `shape:${globalThis.crypto.randomUUID()}`, parent = captureCreationParent(context, point)
    session.beginGesture()
    session.preview(styledCreation({ type: 'create_shape', id, shapeType: 'text', ...parent.pose(point), props: { w: 1, autoSize: true } }, context.creationStyles('text')))
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
    else if (!canContinue()) active.conflict = { type: 'access', revision: status.revision }
    else if (!isEqual(contentOf(shape), active.original) && (!status.isGestureActive || !isEqual(contentOf(shape), active.previewed))) active.conflict = { type: 'content', revision: status.revision, remote: structuredClone(contentOf(shape)) }
    else if (Object.entries(active.originalStyles).some(([key, value]) => styleValue(shape, styleDefinitions[key]) !== value && (!status.isGestureActive || styleValue(shape, styleDefinitions[key]) !== active.styles[key]))) active.conflict = { type: 'style', revision: status.revision }
    // A refreshed attribution is part of the remote baseline too. A local
    // erase/restore may return the text to its original value; it must neither
    // remove the original author nor overwrite a newly received author.
    if (shape?.type === 'note' && (!status.isGestureActive || shape.props.textFirstEditedBy !== active.previewedAuthor)) active.originalAuthor = shape.props.textFirstEditedBy ?? null
    publish()
  }
  function preview() {
    if (!canContinue()) throw new CanvasEditError('编辑目标已锁定或不可见，请保留草稿后重新选择。', 'conflict')
    if (!session.state.get().isGestureActive) session.beginGesture()
    const shape = index.getRecord(active.id)
    const changedText = !isEqual(active.content, active.original)
    const attribution = shape.type !== 'note' ? null : changedText ? noteAuthor.describe(shape, active.content, session.store) : {
      author: active.originalAuthor, commands: [],
    }
    // A draft typed then erased must not leave an unused, newly-previewed
    // author as its only saved change. Never delete a previously saved user.
    const removeUnused = attribution && attribution.author !== noteAuthor.id && !active.authorExisted && session.store.has(noteAuthor.recordId)
    const styles = planStyles([shape], active.styles, canContinue).commands
    session.preview([...(attribution?.commands || []), { type: 'update', id: active.id, changes: { props: { ...propsFor(shape, active.content), ...(attribution && { textFirstEditedBy: attribution.author }) } } }, ...styles, ...(removeUnused ? [{ type: 'delete', ids: [noteAuthor.recordId] }] : [])])
    active.previewed = structuredClone(active.content)
    active.previewedAuthor = attribution?.author ?? null
    active.previewedOpacity = index.getRecord(active.id).opacity
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
    const values = checkedStyles(changes), shape = index.getRecord(id)
    if (!canBegin(id) || !Object.keys(values).length || Object.keys(values).some(key => !textStyleKeys.has(key) || !supportsStyle(shape, styleDefinitions[key]))) throw new CanvasEditError('文字样式只接受适用的字号、字体和对齐选项。')
    if (active && active.id !== id) throw new CanvasEditError('请先结束当前文字编辑。', 'busy')
    return context.setStyles(values, [id])
  }
  function applyStyles(values, ids) {
    if (!active || ids && (ids.length !== 1 || ids[0] !== active.id)) return { status: 'unavailable', reason: 'text-editing' }
    sync()
    if (active.conflict) return { status: 'unavailable', reason: 'conflict' }
    const shape = index.getRecord(active.id)
    const plan = planStyles([shape], values, canContinue)
    if (!Object.keys(plan.adopted).length) return { status: 'unchanged' }
    const previous = { styles: active.styles, originalStyles: active.originalStyles }
    active.originalStyles = { ...active.originalStyles }
    for (const key of Object.keys(plan.adopted)) if (!Object.hasOwn(active.originalStyles, key)) active.originalStyles[key] = styleValue(shape, styleDefinitions[key])
    active.styles = { ...active.styles, ...plan.adopted }
    try { preview() } catch (error) { Object.assign(active, previous); throw error }
    publish()
    return { status: 'preview' }
  }
  function finalPreview() {
    preview()
    if (active.kind === 'text' && !hasContent(active.content)) session.preview([{ type: 'delete', ids: [active.id] }])
  }
  async function finish(extraCommands = []) {
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
        const extra = typeof extraCommands === 'function' ? extraCommands() : extraCommands
        if (extra.length) session.preview(extra)
        active.saving = true; publish()
        try {
          const result = await session.commitGesture()
          if (active !== editing) return result
          active = null; publish(); releaseContext()
          context.stylesCommitted(editing.styles)
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
  return { cancel, create, canBegin, begin, finish, applyStyles, adopt: id => begin(id, true), dispose() { stop(); cancel() }, action(value) {
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
