// Native legacy observation (Electron 42.5 / Chromium, 2026-11-26): clicking
// a text paragraph adds plaintext-only; tail input + Enter + input produces
// literal "Alpha beta gamma!\nnext". Four Shift+Left keys select "next";
// replacing it yields "Alpha beta gamma!\nedited". Clicking another paragraph
// removes only the temporary editability; pre-existing contenteditable=true /
// spellcheck=true survive. Edit-mode clicks suppress the page button action.
// Shared DOM interaction from Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587; MIT, © 2026 Twox.
const COWART_DOM_EDITOR_STYLE_ID = 'cowart-dom-editor-style'
const COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE = 'data-cowart-dom-editor-active'
const COWART_DOM_EDITOR_HOVER_ATTRIBUTE = 'data-cowart-dom-editor-hover'
const COWART_DOM_EDITOR_SELECTED_ATTRIBUTE = 'data-cowart-dom-editor-selected'
const COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE = 'data-cowart-dom-editor-editable'
const COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE =
  'data-cowart-dom-editor-added-contenteditable'
function cowartHtmlDraftDataUrl(htmlContent) {
  const bytes = new TextEncoder().encode(String(htmlContent || ''))
  const chunks = []
  const chunkSize = 8192
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return `data:text/html;base64,${window.btoa(chunks.join(''))}`
}
function serializeHtmlDoctype(doctype) {
  if (!doctype) return '<!doctype html>'
  let result = `<!DOCTYPE ${doctype.name}`
  if (doctype.publicId) result += ` PUBLIC "${doctype.publicId}"`
  if (doctype.systemId) result += doctype.publicId ? ` "${doctype.systemId}"` : ` SYSTEM "${doctype.systemId}"`
  return `${result}>`
}
function serializeCowartHtmlDraftDocument(iframeDocument, transformRoot) {
  const root = iframeDocument.documentElement.cloneNode(true)
  root.removeAttribute(COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE)
  root.querySelector(`#${COWART_DOM_EDITOR_STYLE_ID}`)?.remove()
  for (const element of root.querySelectorAll(
    `[${COWART_DOM_EDITOR_HOVER_ATTRIBUTE}],` +
      `[${COWART_DOM_EDITOR_SELECTED_ATTRIBUTE}],` +
      `[${COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE}],` +
      `[${COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE}]`
  )) {
    element.removeAttribute(COWART_DOM_EDITOR_HOVER_ATTRIBUTE)
    element.removeAttribute(COWART_DOM_EDITOR_SELECTED_ATTRIBUTE)
    element.removeAttribute(COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE)
    if (element.hasAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)) {
      element.removeAttribute('contenteditable')
      element.removeAttribute('spellcheck')
      element.removeAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)
    }
  }
  transformRoot?.(root)
  return `${serializeHtmlDoctype(iframeDocument.doctype)}\n${root.outerHTML}`
}
function isCowartDomTextElement(element) {
  if (!element || ['HTML', 'BODY', 'SCRIPT', 'STYLE', 'SVG', 'CANVAS', 'IMG', 'VIDEO'].includes(element.tagName)) {
    return false
  }
  if (!element.textContent?.trim()) return false
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === window.Node.TEXT_NODE && node.textContent?.trim()
  )
}
function cowartDomSelectionTarget(target, iframeDocument) {
  const ElementClass = iframeDocument.defaultView?.Element
  if (!ElementClass || !(target instanceof ElementClass)) return null
  if (target.closest('script, style, link, meta, title, noscript')) return null
  return target.closest('svg') || target
}
function placeCowartDomCaret(iframeDocument, element, clientX, clientY) {
  const selection = iframeDocument.getSelection()
  if (!selection) return
  let range = iframeDocument.caretRangeFromPoint?.(clientX, clientY) || null
  if (!range || !element.contains(range.startContainer)) {
    range = iframeDocument.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}
function captureCowartDomTextSelection(iframeDocument) {
  const selection = iframeDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    ranges: Array.from({ length: selection.rangeCount }, (_, index) =>
      selection.getRangeAt(index).cloneRange()
    )
  }
}
function restoreCowartDomTextSelection(iframeDocument, selectionSnapshot) {
  if (!selectionSnapshot) return false
  const selection = iframeDocument.getSelection()
  if (!selection) return false
  selection.removeAllRanges()
  if (
    typeof selection.setBaseAndExtent === 'function' &&
    selectionSnapshot.anchorNode?.isConnected &&
    selectionSnapshot.focusNode?.isConnected
  ) {
    selection.setBaseAndExtent(
      selectionSnapshot.anchorNode,
      selectionSnapshot.anchorOffset,
      selectionSnapshot.focusNode,
      selectionSnapshot.focusOffset
    )
    return true
  }
  for (const range of selectionSnapshot.ranges) selection.addRange(range)
  return selection.rangeCount > 0 && !selection.isCollapsed
}
function createCowartHtmlDraftDomEditorSession(iframeDocument, { onSave, onRequestExit, onChange = () => {}, serialize = serializeCowartHtmlDraftDocument, protectUnsaved = false }) {
  const style = iframeDocument.createElement('style')
  style.id = COWART_DOM_EDITOR_STYLE_ID
  style.textContent = `
    [${COWART_DOM_EDITOR_HOVER_ATTRIBUTE}]:not([${COWART_DOM_EDITOR_SELECTED_ATTRIBUTE}]) {
      outline: 1px dashed #2f80ed !important;
      outline-offset: 2px !important;
    }
    [${COWART_DOM_EDITOR_SELECTED_ATTRIBUTE}] {
      outline: 2px solid #2f80ed !important;
      outline-offset: 2px !important;
    }
    [${COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE}] {
      cursor: text !important;
    }
  `
  iframeDocument.head?.append(style)
  iframeDocument.documentElement.setAttribute(COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE, 'true')
  let selectedElement = null
  let hoveredElement = null
  let revision = 0
  let savedRevision = 0
  let savePromise = null
  function clearHoveredElement() {
    hoveredElement?.removeAttribute(COWART_DOM_EDITOR_HOVER_ATTRIBUTE)
    hoveredElement = null
  }
  function clearSelectedElement() {
    if (!selectedElement) return
    selectedElement.removeAttribute(COWART_DOM_EDITOR_SELECTED_ATTRIBUTE)
    selectedElement.removeAttribute(COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE)
    if (selectedElement.hasAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)) {
      selectedElement.removeAttribute('contenteditable')
      selectedElement.removeAttribute('spellcheck')
      selectedElement.removeAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)
    }
    selectedElement = null
  }
  function selectElement(element, event) {
    const textSelection = captureCowartDomTextSelection(iframeDocument)
    if (selectedElement !== element) clearSelectedElement()
    selectedElement = element
    selectedElement.setAttribute(COWART_DOM_EDITOR_SELECTED_ATTRIBUTE, 'true')
    if (!isCowartDomTextElement(selectedElement)) return
    selectedElement.setAttribute(COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE, 'true')
    if (!selectedElement.hasAttribute('contenteditable')) {
      selectedElement.setAttribute('contenteditable', 'plaintext-only')
      selectedElement.setAttribute('spellcheck', 'false')
      selectedElement.setAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE, 'true')
    }
    selectedElement.focus({ preventScroll: true })
    if (!restoreCowartDomTextSelection(iframeDocument, textSelection)) {
      placeCowartDomCaret(iframeDocument, selectedElement, event.clientX, event.clientY)
    }
  }
  function handlePointerOver(event) {
    const nextElement = cowartDomSelectionTarget(event.target, iframeDocument)
    if (!nextElement || nextElement === selectedElement || nextElement === hoveredElement) return
    clearHoveredElement()
    hoveredElement = nextElement
    hoveredElement.setAttribute(COWART_DOM_EDITOR_HOVER_ATTRIBUTE, 'true')
  }
  function handlePointerOut(event) {
    if (hoveredElement && !hoveredElement.contains(event.relatedTarget)) clearHoveredElement()
  }
  function handleClick(event) {
    const element = cowartDomSelectionTarget(event.target, iframeDocument)
    if (!element) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    clearHoveredElement()
    selectElement(element, event)
  }
  function handleInput(event) {
    if (!selectedElement || !selectedElement.contains(event.target)) return
    revision += 1
    onChange(getState())
  }
  function handleKeyDown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onRequestExit()
  }
  function beforeUnload(event) {
    if (revision <= savedRevision) return
    event.preventDefault(); event.returnValue = ''
  }
  // Guard locally: the coalesced parent dirty notification may still be queued
  // when the user closes the page immediately after a keystroke.
  if (protectUnsaved) iframeDocument.defaultView.addEventListener('beforeunload', beforeUnload)
  iframeDocument.addEventListener('pointerover', handlePointerOver, true)
  iframeDocument.addEventListener('pointerout', handlePointerOut, true)
  iframeDocument.addEventListener('click', handleClick, true)
  iframeDocument.addEventListener('input', handleInput, true)
  iframeDocument.addEventListener('keydown', handleKeyDown, true)
  async function flush() {
    if (savePromise) await savePromise
    if (revision === savedRevision) return null
    const targetRevision = revision
    const htmlContent = serialize(iframeDocument)
    savePromise = Promise.resolve(onSave(htmlContent))
    try {
      const result = await savePromise
      savedRevision = targetRevision
      if (revision > savedRevision) return flush()
      return result
    } finally {
      savePromise = null
    }
  }
  function dispose({ save = true } = {}) {
    const pendingSave = save ? flush() : Promise.resolve(null)
    if (protectUnsaved) iframeDocument.defaultView.removeEventListener('beforeunload', beforeUnload)
    iframeDocument.removeEventListener('pointerover', handlePointerOver, true)
    iframeDocument.removeEventListener('pointerout', handlePointerOut, true)
    iframeDocument.removeEventListener('click', handleClick, true)
    iframeDocument.removeEventListener('input', handleInput, true)
    iframeDocument.removeEventListener('keydown', handleKeyDown, true)
    clearHoveredElement()
    clearSelectedElement()
    iframeDocument.documentElement.removeAttribute(COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE)
    style.remove()
    return pendingSave
  }
  function getState() { return { revision, savedRevision, dirty: revision > savedRevision } }
  function snapshot() { return { revision, savedRevision, html: serialize(iframeDocument) } }
  function acknowledge(targetRevision) {
    if (!Number.isSafeInteger(targetRevision) || targetRevision < savedRevision || targetRevision > revision) throw new Error('网页保存版本无效。')
    savedRevision = targetRevision
    onChange(getState())
    return getState()
  }
  return { dispose, flush, snapshot, acknowledge, getState }
}
export { COWART_DOM_EDITOR_STYLE_ID, COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE, COWART_DOM_EDITOR_HOVER_ATTRIBUTE, COWART_DOM_EDITOR_SELECTED_ATTRIBUTE, COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE, COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE, cowartHtmlDraftDataUrl, serializeHtmlDoctype, serializeCowartHtmlDraftDocument, isCowartDomTextElement, cowartDomSelectionTarget, placeCowartDomCaret, captureCowartDomTextSelection, restoreCowartDomTextSelection, createCowartHtmlDraftDomEditorSession }
