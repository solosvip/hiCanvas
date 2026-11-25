import { CURVE_METRICS } from './geo-metrics.js'

const point = (x, y) => ({ x, y })
const polygon = coordinates => coordinates.map(([x, y]) => point(x, y))
const rectangle = () => polygon([[0, 0], [1, 0], [1, 1], [0, 1]])
const regular = (sides, star = false) => Array.from({ length: sides }, (_, i) => {
  const angle = i * Math.PI * 2 / sides - Math.PI / 2, radius = star && i % 2 ? 0.42 : 1
  return point(Math.cos(angle) * radius, Math.sin(angle) * radius)
})

function fit(points, w, h) {
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y))
  const dx = Math.max(...points.map(p => p.x)) - minX, dy = Math.max(...points.map(p => p.y)) - minY
  return points.map(p => point((p.x - minX) / dx * w, (p.y - minY) / dy * h))
}

function ellipse(w, h) {
  const radius = Math.max(w, h) / 2
  const tolerance = Math.max(CURVE_METRICS.minimumTolerance, Math.max(w, h) * CURVE_METRICS.relativeTolerance)
  const segments = Math.max(CURVE_METRICS.minimumArcSegments, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / radius)) / 4) * 4)
  return Array.from({ length: segments }, (_, i) => {
    const angle = i * Math.PI * 2 / segments
    return point(w / 2 + w / 2 * Math.cos(angle), h / 2 + h / 2 * Math.sin(angle))
  })
}

function oval(w, h) {
  if (h > w) return oval(h, w).map(p => point(p.y, p.x))
  const radius = h / 2, halfSegments = ellipse(h, h).length / 2
  const cap = (cx, start) => Array.from({ length: halfSegments + 1 }, (_, i) => {
    const angle = start + i * Math.PI / halfSegments
    return point(cx + radius * Math.cos(angle), radius + radius * Math.sin(angle))
  })
  return [...cap(w - radius, -Math.PI / 2), ...cap(radius, Math.PI / 2)]
}

function heart() {
  return Array.from({ length: CURVE_METRICS.silhouetteSamples }, (_, i) => {
    const t = i * Math.PI * 2 / CURVE_METRICS.silhouetteSamples
    return point(16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)))
  })
}

// An independent cloud silhouette: radial envelope of overlapping ellipses.
// Every sample is shared verbatim by drawing and point queries.
const cloudLobes = [[0.5, 0.5, 0.3, 0.24], [0.23, 0.5, 0.22, 0.28], [0.4, 0.3, 0.28, 0.28], [0.63, 0.3, 0.25, 0.25], [0.8, 0.48, 0.21, 0.24], [0.65, 0.7, 0.28, 0.25], [0.35, 0.7, 0.28, 0.25]]
function cloud() {
  return Array.from({ length: CURVE_METRICS.silhouetteSamples }, (_, i) => {
    const angle = i * Math.PI * 2 / CURVE_METRICS.silhouetteSamples, dx = Math.cos(angle), dy = Math.sin(angle)
    let radius = 0
    for (const [cx, cy, rx, ry] of cloudLobes) {
      const x = (0.5 - cx) / rx, y = (0.5 - cy) / ry, vx = dx / rx, vy = dy / ry
      const a = vx * vx + vy * vy, b = 2 * (x * vx + y * vy), c = x * x + y * y - 1, d = b * b - 4 * a * c
      if (d >= 0) radius = Math.max(radius, (-b + Math.sqrt(d)) / (2 * a))
    }
    return point(0.5 + radius * dx, 0.5 + radius * dy)
  })
}

const arrow = polygon([[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]])
const normalized = factory => (w, h) => fit(factory(), w, h)
// Adding a geometric kind is one registration; callers never switch on kind.
const contours = Object.freeze({
  rectangle: { outline: normalized(rectangle) },
  ellipse: { outline: ellipse, ellipse: true },
  triangle: { outline: normalized(() => polygon([[0.5, 0], [1, 1], [0, 1]])) },
  diamond: { outline: normalized(() => polygon([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])) },
  pentagon: { outline: normalized(() => regular(5)) },
  hexagon: { outline: normalized(() => regular(6)) },
  octagon: { outline: normalized(() => regular(8)) },
  star: { outline: normalized(() => regular(10, true)) },
  rhombus: { outline: normalized(() => polygon([[0.25, 0], [1, 0], [0.75, 1], [0, 1]])) },
  'rhombus-2': { outline: normalized(() => polygon([[0, 0], [0.75, 0], [1, 1], [0.25, 1]])) },
  oval: { outline: oval },
  trapezoid: { outline: normalized(() => polygon([[0.2, 0], [0.8, 0], [1, 1], [0, 1]])) },
  'arrow-right': { outline: normalized(() => arrow) },
  'arrow-left': { outline: normalized(() => arrow.map(p => point(1 - p.x, p.y))) },
  'arrow-up': { outline: normalized(() => arrow.map(p => point(p.y, 1 - p.x))) },
  'arrow-down': { outline: normalized(() => arrow.map(p => point(p.y, p.x))) },
  'x-box': { outline: normalized(rectangle), marks: [[[0.2, 0.2], [0.8, 0.8]], [[0.8, 0.2], [0.2, 0.8]]] },
  'check-box': { outline: normalized(rectangle), marks: [[[0.22, 0.52], [0.43, 0.72], [0.8, 0.28]]] },
  cloud: { outline: normalized(cloud) },
  heart: { outline: normalized(heart) }
})
const cache = new WeakMap()
export function getGeoSize(props) {
  if (!Object.hasOwn(contours, props.geo)) return null
  return { w: props.w, h: props.h + (props.growY || 0) }
}

export function getGeoContour(props) {
  const size = getGeoSize(props)
  if (!size || size.w <= 0 || size.h <= 0) return null
  const signature = `${props.geo}:${size.w}:${size.h}`
  const previous = cache.get(props)
  if (previous?.signature === signature) return previous.value
  const { w, h } = size, registration = contours[props.geo]
  const freezePoints = points => Object.freeze(points.map(p => Object.freeze(p)))
  const value = Object.freeze({
    outline: freezePoints(registration.outline(w, h)),
    decorations: Object.freeze((registration.marks || []).map(line => freezePoints(line.map(([x, y]) => point(x * w, y * h))))),
    ellipse: registration.ellipse ? Object.freeze({ rx: w / 2, ry: h / 2 }) : null
  })
  cache.set(props, { signature, value })
  return value
}
