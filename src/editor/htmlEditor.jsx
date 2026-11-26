// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { cowartHtmlDraftIframes } from './assets.jsx'
async function waitForHtmlDraftDocument(shapeId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const iframe = cowartHtmlDraftIframes.get(shapeId)
    try {
      const iframeDocument = iframe?.contentDocument
      if (iframeDocument?.documentElement && iframeDocument.readyState !== 'loading') {
        return iframeDocument
      }
    } catch (_error) {
      // The iframe is briefly cross-origin while its same-origin blob URL is being prepared.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
  throw new Error('HTML 草稿仍在加载，请稍后重试。')
}
export { waitForHtmlDraftDocument }
export { COWART_DOM_EDITOR_STYLE_ID, COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE, COWART_DOM_EDITOR_HOVER_ATTRIBUTE, COWART_DOM_EDITOR_SELECTED_ATTRIBUTE, COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE, COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE, cowartHtmlDraftDataUrl, serializeHtmlDoctype, serializeCowartHtmlDraftDocument, isCowartDomTextElement, cowartDomSelectionTarget, placeCowartDomCaret, captureCowartDomTextSelection, restoreCowartDomTextSelection, createCowartHtmlDraftDomEditorSession } from '../../content-channel/index.js'
