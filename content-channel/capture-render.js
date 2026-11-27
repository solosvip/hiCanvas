import html2canvas from './capture-clip-fix.js'

import {FontMetrics} from 'html2canvas/dist/lib/render/font-metrics.js'
import {captureFontEnvironment,createFontCaptureClone} from './capture-realm.js'

import { DocumentCloner } from 'html2canvas/dist/lib/dom/document-cloner.js'

const metricDocuments = new WeakMap()
const originalMetrics = FontMetrics.prototype.parseMetrics
FontMetrics.prototype.parseMetrics = function(...args) {
  const original = this._document
  const scoped = metricDocuments.get(original)
  if (!scoped) return originalMetrics.apply(this,args)
  this._document = scoped
  try { return originalMetrics.apply(this,args) }
  finally { this._document = original }
}

const activeCaptures = new WeakMap()
const originalCloneElement = DocumentCloner.prototype.createElementClone
const originalToIFrame = DocumentCloner.prototype.toIFrame
DocumentCloner.prototype.toIFrame = function(doc,bounds) {
  const capture=activeCaptures.get(doc)
  if (!capture) return originalToIFrame.call(this,doc,bounds)
  if (doc.fonts?.size) return createFontCaptureClone(this,doc,bounds,capture.signal).then(frame=>{
    capture.clones.add(frame)
    return frame
  })
  const existing=new Set(doc.querySelectorAll('iframe.html2canvas-container'))
  const result=originalToIFrame.call(this,doc,bounds)
  for (const frame of doc.querySelectorAll('iframe.html2canvas-container')) if (!existing.has(frame)) {
    frame.setAttribute('data-hicanvas-capture-realm','')
    capture.clones.add(frame)
  }
  return result
}

// html2canvas replaces <video> with <canvas> itself and inserts helper nodes.
// Record actual clone identities while its pinned synchronous clone pass runs.
// Supplying the decoded bitmap here prevents any native <video> screenshot.
DocumentCloner.prototype.createElementClone = function (node) {
  const capture = activeCaptures.get(node.ownerDocument)
  const frame = capture?.videoFrames?.get(node)
  let clone
  if (frame) {
    clone = node.ownerDocument.createElement('canvas')
    clone.width = frame.width; clone.height = frame.height
    clone.getContext('2d').drawImage(frame, 0, 0)
    const style = node.ownerDocument.defaultView.getComputedStyle(node)
    for (const property of style) clone.style.setProperty(property, style.getPropertyValue(property))
    clone.style.animation = 'none'
  } else clone = originalCloneElement.call(this, node)
  capture?.nodes.set(node, clone)
  return clone
}

export async function renderHtmlDraftDocument(iframeDocument, { width, height, pixelRatio, freezeAtCurrentFrame = false, videoFrames, captureSignal = new AbortController().signal }) {
  const capture = { nodes: new WeakMap(), videoFrames, signal: captureSignal, clones: new Set() }
  const previous = activeCaptures.get(iframeDocument)
  const fonts = captureFontEnvironment(iframeDocument,document)
  const previousMetrics = metricDocuments.get(document)
  try {
  if (fonts.canvas) {
    fonts.canvas.width=Math.floor(width*pixelRatio);fonts.canvas.height=Math.floor(height*pixelRatio)
    metricDocuments.set(document,fonts.document)
  }
  let rendering
  activeCaptures.set(iframeDocument,capture)
  try {
  rendering = html2canvas(iframeDocument.documentElement, {
    allowTaint: false,
    canvas: fonts.canvas,
    backgroundColor: '#ffffff',
    height,
    logging: false,
    onclone(clonedDocument) {
      clonedDocument.querySelectorAll('script').forEach((script) => script.remove())
      if (freezeAtCurrentFrame) {
        for (const animation of iframeDocument.getAnimations?.() || []) {
          const target = animation.effect?.target
          const clone = capture.nodes.get(target)
          if (!clone || !animation.effect?.getKeyframes) continue
          const computed = iframeDocument.defaultView.getComputedStyle(target)
          for (const key of new Set(animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame)))) {
            if (['offset', 'computedOffset', 'easing', 'composite'].includes(key)) continue
            clone.style[key] = computed[key]
          }
          clone.style.animation = 'none'
        }
      }
      const captureStyle = clonedDocument.createElement('style')
      captureStyle.textContent = `
        html, body { width: ${width}px !important; height: ${height}px !important; }
        *, *::before, *::after { animation-play-state: paused !important; caret-color: transparent !important; transition: none !important; }
      `
      clonedDocument.head?.append(captureStyle)
    },
    scale: pixelRatio,
    scrollX: 0,
    scrollY: 0,
    useCORS: true,
    width,
    windowHeight: height,
    windowWidth: width,
    x: 0,
    y: 0
  })
  } finally {
    // The clone pass runs before html2canvas's first await. Restore immediately
    // so separate capture documents can render concurrently without interference.
    if (previous) activeCaptures.set(iframeDocument, previous)
    else activeCaptures.delete(iframeDocument)
  }
  return await rendering
  } finally {
    for (const frame of capture.clones) frame.remove()
    fonts.dispose()
    if (previousMetrics) metricDocuments.set(document,previousMetrics)
    else metricDocuments.delete(document)
  }
}
