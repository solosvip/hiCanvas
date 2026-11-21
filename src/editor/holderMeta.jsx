// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { AI_SLIDES_GAP, AI_SLIDES_PADDING, AI_IMAGE_SIZE_MIN, AI_IMAGE_SIZE_MAX, AI_IMAGE_ASPECT_PRESETS } from './configuration.jsx'
import { isCowartHtmlDraftDataUrl, cowartHtmlDraftAssetUrlFromVirtualUrl } from './assets.jsx'
function getAiImageHolderMeta() {
  return {
    cowartAiImageHolder: true,
    cowartAiImageHolderVersion: 1
  }
}
function getAiDraftHolderMeta() {
  return {
    cowartAiDraftHolder: true,
    cowartAiDraftHolderVersion: 1
  }
}
function getAiSlidesMeta() {
  return {
    cowartAiSlides: true,
    cowartAiSlidesVersion: 1,
    cowartAiSlidesFlow: 'horizontal',
    cowartAiSlidesGap: AI_SLIDES_GAP,
    cowartAiSlidesPadding: AI_SLIDES_PADDING
  }
}
function isAiImageHolderShape(shape) {
  return shape?.type === 'frame' && shape.meta?.cowartAiImageHolder === true
}
function isAiDraftHolderShape(shape) {
  return shape?.type === 'frame' && shape.meta?.cowartAiDraftHolder === true
}
function isAiFilmHolderShape(shape) {
  return isAiDraftHolderShape(shape) && shape.meta?.cowartAiFilmHolder === true
}
function isCowartFilmShape(shape) {
  return isCowartHtmlDraftEmbedShape(shape) && shape.meta?.cowartFilm === true
}
function isAiSlidesShape(shape) {
  return shape?.type === 'frame' && shape.meta?.cowartAiSlides === true
}
function isCowartAiHolderShape(shape) {
  return isAiImageHolderShape(shape) || isAiDraftHolderShape(shape)
}
function isAiSlidesItemShape(shape) {
  return isImageShape(shape) || isCowartHtmlDraftEmbedShape(shape)
}
function isCowartHtmlDraftEmbedShape(shape) {
  if (shape?.type !== 'embed') return false
  if (shape.meta?.cowartHtmlDraft === true) return true
  return Boolean(
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape.props?.url) ||
      isCowartHtmlDraftDataUrl(shape.props?.url)
  )
}
function isImageShape(shape) {
  return shape?.type === 'image'
}
function isAiImageAspectLocked(shape) {
  return isCowartAiHolderShape(shape) && shape.meta?.cowartAiAspectLocked === true
}
function clampAiImageSize(value) {
  if (!Number.isFinite(value)) return null
  return Math.round(Math.min(Math.max(value, AI_IMAGE_SIZE_MIN), AI_IMAGE_SIZE_MAX))
}
function getAiImageAspectRatio(shape) {
  const metaRatio = Number(shape?.meta?.cowartAiAspectRatio)
  if (Number.isFinite(metaRatio) && metaRatio > 0) return metaRatio
  const w = Number(shape?.props?.w)
  const h = Number(shape?.props?.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null
  return w / h
}
function getAiImageAspectPreset(shape) {
  if (!shape?.props) return null
  const w = Number(shape.props.w)
  const h = Number(shape.props.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null
  const shapeRatio = w / h
  return (
    AI_IMAGE_ASPECT_PRESETS.find((preset) => {
      const presetRatio = preset.w / preset.h
      return Math.abs(shapeRatio - presetRatio) < 0.01
    }) ?? null
  )
}
function formatAiImageSize(value) {
  return String(Math.round(Number.isFinite(value) ? value : 0))
}
function getAspectIconStyle(preset) {
  const maxSize = 22
  const scale = Math.min(maxSize / preset.w, maxSize / preset.h)
  return {
    width: `${Math.max(8, Math.round(preset.w * scale))}px`,
    height: `${Math.max(8, Math.round(preset.h * scale))}px`
  }
}
export { getAiImageHolderMeta, getAiDraftHolderMeta, getAiSlidesMeta, isAiImageHolderShape, isAiDraftHolderShape, isAiFilmHolderShape, isCowartFilmShape, isAiSlidesShape, isCowartAiHolderShape, isAiSlidesItemShape, isCowartHtmlDraftEmbedShape, isImageShape, isAiImageAspectLocked, clampAiImageSize, getAiImageAspectRatio, getAiImageAspectPreset, formatAiImageSize, getAspectIconStyle }
