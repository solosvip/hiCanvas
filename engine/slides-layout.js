import { CanvasEditError } from './errors.js'

export const isSlidesContainer = shape => shape?.type === 'frame' && shape.meta?.cowartAiSlides === true

// The owned-HTML forms are existing saved formats, not arbitrary online embeds.
export function isSlidesPage(shape) {
  if (shape?.type === 'image') return true
  if (shape?.type !== 'embed') return false
  if (shape.meta?.cowartHtmlDraft === true) return true
  const url = shape.props?.url
  if (typeof url !== 'string') return false
  if (/^data:text\/html(?:;[^,]*)?,/i.test(url)) return true
  const local = value => /^(?:\/(?:page-assets|assets)\/|\/c\/[^/]+\/(?:page-assets|assets)\/)/.test(value) && /\.html?(?:$|[?#])/i.test(value)
  if (local(url)) return true
  try { const parsed = new URL(url); return parsed.origin === 'http://cowart.local' && local(parsed.pathname + parsed.search + parsed.hash) }
  catch { return false }
}

const normalizeDimension = value => Math.max(1, Number(value) || 1)

/** Read-only direct pages, ordered by local horizontal center then parent index. */
export function getSlidesPages(container, children) {
  if (!isSlidesContainer(container)) return []
  return children.filter(shape => shape.parentId === container.id && isSlidesPage(shape)).sort((a, b) =>
    (a.x + normalizeDimension(a.props.w) / 2) - (b.x + normalizeDimension(b.props.w) / 2) || (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id)))
}

const parameter = (value, fallback) => { const number = Number(value); return Number.isFinite(number) && number !== 0 ? number : fallback }
export function getSlidesSpacing(container, pages = []) {
  const padding = parameter(container.meta?.cowartAiSlidesPadding, 12)
  let gap = parameter(container.meta?.cowartAiSlidesGap, 32)
  // Keep consecutive centers at least one unit apart. Extreme saved negative
  // gaps must not reverse order and make the legacy timer write forever.
  for (let i = 1; i < pages.length; i++) gap = Math.max(gap, 1 - (normalizeDimension(pages[i - 1].props.w) / 2 + normalizeDimension(pages[i].props.w) / 2))
  return { padding, gap }
}

/** Pure plan shared by finalized commands and the legacy adapter; never writes. */
export function planSlidesLayout(container, children) {
  const pages = getSlidesPages(container, children)
  if (!pages.length) return []
  const { padding, gap } = getSlidesSpacing(container, pages)
  let cursor = padding, height = 0
  const updates = []
  for (const page of pages) {
    const w = normalizeDimension(page.props.w), h = normalizeDimension(page.props.h)
    if (![cursor, padding, w, h].every(Number.isFinite)) throw new CanvasEditError('幻灯片排版尺寸超出有效范围。', 'slides-layout-overflow')
    if (Math.abs(page.x - cursor) > .01 || Math.abs(page.y - padding) > .01 || page.rotation !== 0) updates.push({ id: page.id, type: page.type, x: cursor, y: padding, rotation: 0 })
    cursor += w + gap
    height = Math.max(height, h)
  }
  const w = Math.max(1048, cursor - gap + padding), h = Math.max(600, height + padding * 2)
  if (![cursor, w, h].every(Number.isFinite)) throw new CanvasEditError('幻灯片排版尺寸超出有效范围。', 'slides-layout-overflow')
  if (Math.abs(container.props.w - w) > .01 || Math.abs(container.props.h - h) > .01) updates.push({ id: container.id, type: container.type, props: { w, h } })
  return updates
}
