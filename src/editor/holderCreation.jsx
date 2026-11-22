// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { createShapeId } from "tldraw"
import { filmAnalyticsContext } from "../filmAnalytics.js"
import { trackFilmFrameCreated } from "../analytics.js"
import { AI_IMAGE_HOLDER_LABEL, AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, AI_DRAFT_HOLDER_LABEL, AI_DRAFT_HOLDER_DEFAULT_W, AI_DRAFT_HOLDER_DEFAULT_H, AI_FILM_LABEL, AI_SLIDES_LABEL, AI_SLIDES_DEFAULT_W, AI_SLIDES_DEFAULT_H } from './configuration.jsx'
import { getAiImageHolderMeta, getAiDraftHolderMeta, getAiSlidesMeta } from './holderMeta.jsx'
function createAiImageHolderShape(editor, id, shapeOverrides = {}) {
  const scale = editor.getResizeScaleFactor()
  const { meta, props, ...shapeRecordOverrides } = shapeOverrides
  const { scale: _scale, ...frameProps } = props ?? {}
  return editor.createShape({
    ...shapeRecordOverrides,
    id,
    type: 'frame',
    meta: {
      ...getAiImageHolderMeta(),
      ...meta
    },
    props: {
      w: AI_IMAGE_HOLDER_DEFAULT_W * scale,
      h: AI_IMAGE_HOLDER_DEFAULT_H * scale,
      name: AI_IMAGE_HOLDER_LABEL,
      color: 'blue',
      ...frameProps
    }
  })
}
function createAiImageHolderAtViewportCenter(editor) {
  const scale = editor.getResizeScaleFactor()
  const w = AI_IMAGE_HOLDER_DEFAULT_W * scale
  const h = AI_IMAGE_HOLDER_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()
  createAiImageHolderShape(editor, id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h }
  })
  editor.select(id)
  editor.setCurrentTool('select.idle')
}
function createAiDraftHolderShape(editor, id, shapeOverrides = {}) {
  const scale = editor.getResizeScaleFactor()
  const { meta, props, ...shapeRecordOverrides } = shapeOverrides
  const { scale: _scale, ...frameProps } = props ?? {}
  return editor.createShape({
    ...shapeRecordOverrides,
    id,
    type: 'frame',
    meta: {
      ...getAiDraftHolderMeta(),
      ...meta
    },
    props: {
      w: AI_DRAFT_HOLDER_DEFAULT_W * scale,
      h: AI_DRAFT_HOLDER_DEFAULT_H * scale,
      name: AI_DRAFT_HOLDER_LABEL,
      color: 'blue',
      ...frameProps
    }
  })
}
function createAiDraftHolderAtViewportCenter(editor) {
  const scale = editor.getResizeScaleFactor()
  const w = AI_DRAFT_HOLDER_DEFAULT_W * scale
  const h = AI_DRAFT_HOLDER_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()
  createAiDraftHolderShape(editor, id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h }
  })
  editor.select(id)
  editor.setCurrentTool('select.idle')
}
function createAiFilmHolderShape(editor, id, shapeOverrides = {}) {
  const { meta, props, ...rest } = shapeOverrides
  const result = createAiDraftHolderShape(editor, id, {
    ...rest,
    meta: { cowartAiFilmHolder: true, cowartFilmStyle: 'product-launch', cowartFilmDuration: 15, cowartFilmMuted: false, ...meta },
    props: { name: AI_FILM_LABEL, ...props }
  })
  const shape = editor.getShape(id)
  if (shape) trackFilmFrameCreated(filmAnalyticsContext(shape))
  return result
}
function createAiFilmHolderAtViewportCenter(editor) {
  const scale = editor.getResizeScaleFactor()
  const w = AI_DRAFT_HOLDER_DEFAULT_W * scale
  const h = AI_DRAFT_HOLDER_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()
  createAiFilmHolderShape(editor, id, { x: center.x - w / 2, y: center.y - h / 2, props: { w, h } })
  editor.select(id)
  editor.setCurrentTool('select.idle')
}
function createAiSlidesShape(editor, id, shapeOverrides = {}) {
  const scale = editor.getResizeScaleFactor()
  const { meta, props, ...shapeRecordOverrides } = shapeOverrides
  const { scale: _scale, ...frameProps } = props ?? {}
  return editor.createShape({
    ...shapeRecordOverrides,
    id,
    type: 'frame',
    meta: {
      ...getAiSlidesMeta(),
      ...meta
    },
    props: {
      w: AI_SLIDES_DEFAULT_W * scale,
      h: AI_SLIDES_DEFAULT_H * scale,
      name: AI_SLIDES_LABEL,
      color: 'blue',
      ...frameProps
    }
  })
}
function createAiSlidesAtViewportCenter(editor) {
  const scale = editor.getResizeScaleFactor()
  const w = AI_SLIDES_DEFAULT_W * scale
  const h = AI_SLIDES_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()
  createAiSlidesShape(editor, id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h }
  })
  editor.select(id)
  editor.setCurrentTool('select.idle')
}
export { createAiImageHolderShape, createAiImageHolderAtViewportCenter, createAiDraftHolderShape, createAiDraftHolderAtViewportCenter, createAiFilmHolderShape, createAiFilmHolderAtViewportCenter, createAiSlidesShape, createAiSlidesAtViewportCenter }
