const boxOf = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
export const opaquePaintIntersectsPixel = (box, point) => point.cssX + point.cssSize > box.x && point.cssX < box.x + box.width && point.cssY + point.cssSize > box.y && point.cssY < box.y + box.height
const opacityOf = node => { let value = 1; for (let p = node; p; p = p.parentElement) value *= Number(getComputedStyle(p).opacity); return value }
const effects = node => {
  const style = getComputedStyle(node)
  return [style.boxShadow, style.textShadow, style.filter].some(value => value && value !== 'none')
}

function paintBoxes(node) {
  const boxes = []
  for (const element of [node, ...node.querySelectorAll('*')]) {
    if (effects(element)) return [{ x: 0, y: 0, width: innerWidth, height: innerHeight }]
    if (element instanceof HTMLElement) boxes.push(boxOf(element))
    if (!(element instanceof SVGSVGElement)) continue
    const box = boxOf(element), clip = element.style.clipPath.match(/^inset\((-?[\d.]+)px\)$/)
    if (clip) {
      const margin = Math.max(0, -Number(clip[1])), matrix = element.getScreenCTM()
      if (!matrix) return [{ x: 0, y: 0, width: innerWidth, height: innerHeight }]
      const dx = margin * (Math.abs(matrix.a) + Math.abs(matrix.c)), dy = margin * (Math.abs(matrix.b) + Math.abs(matrix.d))
      boxes.push({ x: box.x - dx, y: box.y - dy, width: box.width + 2 * dx, height: box.height + 2 * dy })
    } else if (['hidden', 'clip'].includes(getComputedStyle(element).overflow)) boxes.push(box)
    // An unbounded SVG can paint outside its viewport. Never use that viewport
    // alone to claim that a neighboring opaque edge is unobstructed.
    else return [{ x: 0, y: 0, width: innerWidth, height: innerHeight }]
  }
  return boxes
}

export function readOpaqueEdgeCandidates(points) {
  const nodes = [...document.querySelectorAll('[data-shape-id], #status, #navigation')]
  const shapes = nodes.flatMap(node => {
    const svg = node.querySelector(':scope > svg')
    if (node.dataset.shapeType !== 'geo' || !svg || opacityOf(svg) !== 1 || node.querySelector('[data-shape-id]')) return []
    if ([node, svg].some(effects)) return []
    const bounds = boxOf(svg)
    return bounds.width > 0 && bounds.height > 0 ? [{ node, shape: { id: node.dataset.shapeId, opacity: 1, bounds } }] : []
  })
  const blockers = nodes.filter(node => opacityOf(node) > 0).map(node => ({ node, boxes: paintBoxes(node) }))
  const candidates = [], rejected = []
  for (const point of points) {
    if (!(Number.isFinite(point.cssSize) && point.cssSize > 0)) throw new Error('不透明边缘取证需要完整物理像素的CSS范围')
    const possible = shapes.filter(({ shape: { bounds: b } }) => {
      const dx = Math.max(b.x - point.cssX, point.cssX - b.x - b.width, 0), dy = Math.max(b.y - point.cssY, point.cssY - b.y - b.height, 0)
      const distance = dx || dy ? Math.hypot(dx, dy) : Math.min(point.cssX - b.x, b.x + b.width - point.cssX, point.cssY - b.y, b.y + b.height - point.cssY)
      return distance <= 1
    })
    const candidate = possible.length === 1 && possible[0]
    const obstruction = candidate && blockers.some(blocker => blocker.node !== candidate.node && blocker.boxes.some(box => opaquePaintIntersectsPixel(box, point)))
    if (candidate && !obstruction) candidates.push({ ...point, shape: candidate.shape })
    else rejected.push({ ...point, reason: obstruction ? 'other opaque paint may overlap' : 'no unique opaque SVG edge within 1 CSS pixel' })
  }
  return { candidates, rejected }
}
