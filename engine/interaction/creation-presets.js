// Native legacy shape-picker observations on 2026-11-26. These are document
// dimensions, not interface styles; star and cloud have distinct click sizes.
export const geometryVariants = Object.freeze(['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'oval', 'rhombus', 'star', 'cloud', 'heart', 'x-box', 'check-box', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'pentagon', 'octagon', 'rhombus-2', 'trapezoid'])
export const creationToolIds = Object.freeze(['geo', 'frame', 'text', 'line', 'arrow', 'ai-image', 'ai-draft', 'ai-film', 'ai-slides'])
// Native blank-double and toolbar-drag text records, 2026-11-26: font=draw.
export const textCreationProps = Object.freeze({ font: 'draw' })

export function geometryPreset(geo) {
  const [w, h] = geo === 'star' ? [200, 190] : geo === 'cloud' ? [300, 180] : [200, 200]
  return { id: 'geo', shapeType: 'geo', w, h, props: { geo, dash: 'draw', font: 'draw' } }
}

// hiCanvas's MIT holder records, independently read back through the running
// legacy toolbar. AI identity does not imply aspect locking: these are frames.
const aiFrames = {
  'ai-image': [512, 683, 'AI 图片', { cowartAiImageHolder: true, cowartAiImageHolderVersion: 1 }],
  'ai-draft': [1024, 576, 'AI 网页', { cowartAiDraftHolder: true, cowartAiDraftHolderVersion: 1 }],
  'ai-film': [1024, 576, 'AI 影片', { cowartAiDraftHolder: true, cowartAiDraftHolderVersion: 1, cowartAiFilmHolder: true, cowartFilmStyle: 'product-launch', cowartFilmDuration: 15, cowartFilmMuted: false }],
  'ai-slides': [1048, 600, 'AI 幻灯片', { cowartAiSlides: true, cowartAiSlidesVersion: 1, cowartAiSlidesFlow: 'horizontal', cowartAiSlidesGap: 32, cowartAiSlidesPadding: 12 }],
}
export function aiFramePreset(id) {
  const [w, h, name, meta] = aiFrames[id]
  return { id, shapeType: 'frame', w, h, props: { name, color: 'blue' }, meta: { ...meta }, immediateAtCenter: true }
}
