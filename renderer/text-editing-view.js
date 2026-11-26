import { Editor } from '@tiptap/core'
import { canvasTextExtensions } from './text-schema.js'
import { canvasFontStyle } from './font-families.js'
import { getShapeTextLayout, shapeToPagePoint, createConnectionContext } from './geometry.js'
import { colorPaint, noteLabelPaint } from './palette.js'
import { measureFrameTitle } from './frame-title-measure.js'

// A view owns its live document/selection. update() seeds it only on entry;
// later calls reposition it without setContent, remounting, focus or selection.
export function createTextEditingView(element, store, callbacks = {}) {
  const doc = element.ownerDocument
  let current = null, connections = null
  const stop = store.addHistoryInterceptor(({ changes }) => {
    connections?.applyChanges(changes)
    if (current) queueMicrotask(() => { if (current?.description) update(current.description, current.camera) })
  })
  function close() {
    if (!current) return
    const previous = current; current = null
    const focused = previous.node.contains(doc.activeElement)
    try { previous.editor?.destroy() }
    finally {
      previous.node.remove()
      if (focused) { element.focus({ preventScroll: true }); callbacks.onInputContext?.({ owner: 'canvas' }) }
    }
  }
  function enter(value) {
    close()
    connections ||= createConnectionContext(store.allRecords())
    const node = doc.createElement(value.kind === 'frame' ? 'input' : 'div')
    node.dataset.canvasTextEditor = ''; node.dataset.canvasInputOwner = 'text-editing'
    node.setAttribute('aria-label', value.kind === 'frame' ? '编辑画框标题' : '编辑画布文字')
    if (value.kind !== 'frame') node.setAttribute('role', 'textbox')
    node.addEventListener('focusin', () => callbacks.onInputContext?.({ owner: 'text-editing' }))
    for (const active of [true, false]) node.addEventListener(active ? 'compositionstart' : 'compositionend', () => callbacks.onInputContext?.({ owner: 'text-editing', isComposing: active }))
    // Native caret/selection/scrolling belongs to the text view; its pointer
    // events must not be captured and translated into canvas gestures.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) node.addEventListener(type, event => event.stopPropagation())
    element.append(node)
    const view = current = { id: value.id, epoch: value.epoch, node, editor: null, shape: store.get(value.id) }
    const selection = editor => ({ from: editor.state.selection.from, to: editor.state.selection.to })
    if (value.kind === 'frame') {
      node.value = value.content; node.placeholder = 'Frame'
      node.addEventListener('input', () => callbacks.onChange?.(node.value))
      node.addEventListener('select', () => callbacks.onSelection?.({ from: node.selectionStart, to: node.selectionEnd }))
      node.focus({ preventScroll: true }); node.select()
    } else {
      let seeded
      const original = structuredClone(value.content)
      try {
        view.editor = new Editor({
          element: node, content: original, extensions: canvasTextExtensions(original), injectCSS: false, enableContentCheck: true,
          editorProps: { attributes: { spellcheck: 'false', 'aria-label': '编辑画布文字' }, handleKeyDown: (_view, event) => event.defaultPrevented },
          onUpdate: ({ editor }) => {
            if (current !== view) return
            const content = editor.getJSON()
            callbacks.onChange?.(JSON.stringify(content) === seeded ? structuredClone(original) : content, selection(editor))
          },
          onSelectionUpdate: ({ editor }) => { if (current === view) callbacks.onSelection?.(selection(editor)) },
          onContentError: ({ error }) => { throw error },
        })
        seeded = JSON.stringify(view.editor.getJSON())
        queueMicrotask(() => { if (current === view) view.editor.commands.focus('all', { scrollIntoView: false }) })
      } catch (error) { close(); callbacks.onError?.(error); throw error }
    }
  }
  function update(value, camera) {
    if (!value) { close(); return }
    if (!current || current.id !== value.id || current.epoch !== value.epoch) enter(value)
    const view = current, shape = store.get(value.id) || view.shape
    if (view.editor) {
      if (view.editor.isEditable === Boolean(value.isSaving)) view.editor.setEditable(!value.isSaving, false)
    } else view.node.readOnly = Boolean(value.isSaving)
    if (!shape) return
    view.shape = shape
    view.description = value; view.camera = { ...camera }
    const records = Object.create(null)
    for (let record = shape; record?.typeName === 'shape'; record = store.get(record.parentId)) records[record.id] = record
    const layout = getShapeTextLayout(shape, connections, { zoom: camera.z, titleWidth: shape.type === 'frame' ? measureFrameTitle(shape.props.name) : undefined })
    const geo = shape.type === 'geo', scale = layout.scale || 1
    const originScale = shape.type === 'note' ? scale : 1
    const origin = shapeToPagePoint({ store: records }, shape.id, { x: (geo ? layout.padding : layout.x) * originScale, y: layout.y * originScale })
    const angle = Object.values(records).reduce((sum, record) => sum + (record.rotation || 0), 0)
    const paint = colorPaint({ color: ['geo', 'arrow'].includes(shape.type) ? shape.props.labelColor : shape.props.color })
    Object.assign(view.node.style, {
      ...canvasFontStyle(layout.font),
      left: `${(origin.x + camera.x) * camera.z}px`, top: `${(origin.y + camera.y) * camera.z}px`,
      transform: `rotate(${angle}rad) scale(${camera.z * scale})`,
      width: geo ? `${Math.max(1, shape.props.w - layout.padding * 2)}px` : layout.autoSize ? 'max-content' : `${layout.w}px`,
      fontFamily: layout.font ? canvasFontStyle(layout.font).fontFamily : 'system-ui',
      fontSize: `${layout.size}px`, lineHeight: `${layout.lineHeight}px`,
      textAlign: layout.align?.includes('middle') ? 'center' : layout.align?.startsWith('end') ? 'end' : 'start',
      color: shape.type === 'note' ? noteLabelPaint(shape.props) : paint.text,
    })
    for (const [name, weight, italic] of [['bold', 700, 'normal'], ['italic', 400, 'italic'], ['bold-italic', 700, 'italic']]) view.node.style.setProperty(`--canvas-text-${name}-axes`, canvasFontStyle(layout.font, weight, italic).fontVariationSettings)
    view.node.dataset.textConflict = value.conflict?.type || ''
  }
  return { update, dispose() { stop(); close() } }
}
