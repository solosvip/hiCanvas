import { getGeoContour } from './geo-contours.js'
import { strokeWidth } from './geo-metrics.js'

// 2026-11-25 对照运行中的旧版画面测量，未参照任何源码。
// Synthetic 160 × 100 shapes, stable IDs shape:hand-{kind}-{size}; 400%, DPR 2
// (8 pixels/document unit). Integrate antialias coverage across edge normals;
// 7 samples/edge, excluding max(20% edge, twice pen width) at corners
// (capped at 45%); ellipse at 80 angular positions.
// Final observed means s/m/l/xl: rectangle 2.340/3.874/5.815/11.983,
// ellipse 2.238/4.214/6.173/11.029, star 2.299/4.066/5.666/10.996,
// triangle 2.289/4.214/5.917/11.634. Calibration means below use the
// central three samples per edge to avoid estimating width through a bend.
// Observed full sampled width envelope
// roughly 1–1.56 × solid width; center displacement < .5/1.3/1.6/2 units.
// Rectangle top-left effective corner radii 3.65/5.87/8.40/16.97 units:
// a quadratic corner trimmed at twice the nominal width gives this roundness.
// Filled and unfilled sheets share the same ink boundary; fill ends under ink.
// The comparison table and raw screenshots are attached to #79's handoff.
const means = Object.freeze({ rectangle: [2.314, 3.869, 5.817, 11.916], ellipse: [2.237, 4.213, 6.173, 11.028], star: [2.276, 3.986, 5.633, 10.998], triangle: [2.249, 4.124, 5.895, 11.634] })
const sizes = ['s', 'm', 'l', 'xl'], cache = new WeakMap(), tau = Math.PI * 2
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${+p.x.toFixed(3)},${+p.y.toFixed(3)}`).join(' ') + ' Z'

function phaseOf(id) {
  let hash = 2166136261
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
  return hash / 2 ** 32 * tau
}

function roundedPolygon(points, width, spacing, closed = true) {
  const result = [], length = points.length
  const entries = points.map((p, i) => {
    const previous = points[(i + length - 1) % length], next = points[(i + 1) % length]
    const trim = !closed && (i === 0 || i === length - 1) ? 0 : Math.min(width * 2, distance(previous, p) * .28, distance(next, p) * .28)
    return { vertex: p, in: mix(p, previous, trim / (distance(previous, p) || 1)), out: mix(p, next, trim / (distance(next, p) || 1)) }
  })
  for (let i = 0; i < length; i++) {
    const corner = entries[i]
    result.push(corner.in)
    if (distance(corner.in, corner.out) > 0) for (let step = 1; step <= 8; step++) {
      const t = step / 8
      result.push(mix(mix(corner.in, corner.vertex, t), mix(corner.vertex, corner.out, t), t))
    }
    if (!closed && i === length - 1) continue
    const next = entries[(i + 1) % length].in, segments = Math.min(32, Math.ceil(distance(corner.out, next) / spacing))
    for (let step = 1; step < segments; step++) result.push(mix(corner.out, next, step / segments))
  }
  return result
}

function smoothSamples(points, spacing) {
  const lengths = points.map((p, i) => distance(p, points[(i + 1) % points.length]))
  const total = lengths.reduce((sum, n) => sum + n, 0), count = Math.min(256, Math.max(64, Math.ceil(total / spacing)))
  let edge = 0, start = 0
  return Array.from({ length: count }, (_, i) => {
    const target = total * i / count
    while (edge < lengths.length - 1 && start + lengths[edge] < target) start += lengths[edge++]
    return mix(points[edge], points[(edge + 1) % points.length], (target - start) / (lengths[edge] || 1))
  })
}

function measuredStar(w, h) {
  // Raster intersections give half-radius inner vertices (e.g. x=55.3,
  // y=32.9 for the upper-left notch at 160×100). This is draw-only;
  // the pre-existing nominal query contour and all other dash styles stay put.
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? .5 : 1
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  })
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y))
  const dx = Math.max(...points.map(p => p.x)) - minX, dy = Math.max(...points.map(p => p.y)) - minY
  return points.map(p => ({ x: (p.x - minX) / dx * w, y: (p.y - minY) / dy * h }))
}

function insidePolygon(point, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function brushUnion(outline, left, right, closed) {
  // A collapsed offset loop cannot represent a hole. All positively wound
  // triangles/disks form a union with nonzero fill, including tiny/narrow
  // shapes and acute turns. A single compound path keeps the DOM unchanged.
  const pieces = []
  const triangle = points => {
    const [a, b, c] = points
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (area) pieces.push(path(area > 0 ? points : points.reverse()))
  }
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const radius = +(.5 * p.width).toFixed(3), x = +p.x.toFixed(3), y = +p.y.toFixed(3)
    const rightX = +(x + radius).toFixed(3), leftX = +(x - radius).toFixed(3)
    // Native arcs retain round caps without hundreds of fixed vertices.
    pieces.push(`M${rightX},${y} A${radius},${radius} 0 1 1 ${leftX},${y} A${radius},${radius} 0 1 1 ${rightX},${y} Z`)
    if (!closed && i === outline.length - 1) continue
    const next = (i + 1) % outline.length
    triangle([left[i], left[next], right[next]])
    triangle([left[i], right[next], right[i]])
  }
  return pieces.join(' ')
}

function brush(points, width, mean, phase, closed = true) {
  const lengths = points.map((p, i) => i || closed ? distance(p, points[(i + points.length - 1) % points.length]) : 0)
  const total = lengths.reduce((sum, n) => sum + n, 0) || 1
  let traveled = 0
  const pressure = points.map((_p, i) => { traveled += lengths[i]; return ((1 + .75 * Math.sin(traveled / total * tau * 2 + phase) + .25 * Math.sin(traveled / total * tau * 5 + phase + 1)) / 2) ** 2 })
  const average = pressure.reduce((sum, n, i) => sum + n * lengths[i], 0) / total || 1
  traveled = 0
  const outline = points.map((p, i) => {
    traveled += lengths[i]
    const before = points[i === 0 ? closed ? points.length - 1 : 0 : i - 1], after = points[i === points.length - 1 ? closed ? 0 : i : i + 1]
    const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1
    const normal = { x: -dy / length, y: dx / length }, t = traveled / total
    const displacement = width * .16 * (.65 * Math.sin(t * tau * 3 + phase + 1) + .35 * Math.sin(t * tau * 7 + phase))
    return { x: p.x + normal.x * displacement, y: p.y + normal.y * displacement, width: width + (mean - width) * pressure[i] / average, normal }
  })
  const side = direction => outline.map(p => ({ x: p.x + direction * p.normal.x * p.width / 2, y: p.y + direction * p.normal.y * p.width / 2 }))
  const left = side(1), right = side(-1)
  let strokePath
  const separated = closed && outline.every((p, i) => {
    const midpoint = mix(p, outline[(i + 1) % outline.length], .5)
    return insidePolygon(p, left) !== insidePolygon(p, right) && insidePolygon(midpoint, left) !== insidePolygon(midpoint, right)
  })
  if (separated) strokePath = path(left) + ' ' + path([...right].reverse())
  else strokePath = brushUnion(outline, left, right, closed)

  return { outline: Object.freeze(outline.map(({ normal: _normal, ...p }) => Object.freeze(p))), fillPath: path(outline), strokePath }
}

// Local document geometry only. Camera, translation, time and drawing order are
// deliberately absent from both the seed and cache signature. Cache is weak and
// keyed by document props, so removed records can be collected.
export function getHandDrawnContour(shape) {
  if (shape?.type !== 'geo' || shape.props?.dash !== 'draw') return null
  const props = shape.props, contour = getGeoContour(props)
  if (!contour) return null
  const signature = `${shape.id}:${props.geo}:${props.w}:${props.h}:${props.growY || 0}:${props.size}:${props.scale || 1}`
  const previous = cache.get(props)
  if (previous?.signature === signature) return previous.value
  const width = strokeWidth(props), scale = props.scale || 1, phase = phaseOf(shape.id || ''), spacing = 12 * scale
  const nominal = props.geo === 'star' ? measuredStar(props.w, props.h + (props.growY || 0)) : contour.outline
  const points = contour.continuous ? smoothSamples(nominal, spacing) : roundedPolygon(nominal, width, spacing)
  const mean = (means[props.geo]?.[sizes.indexOf(props.size)] || width / scale * 1.16) * scale
  const result = brush(points, width, mean, phase)
  const decorationPaths = contour.decorations.map((line, i) => brush(roundedPolygon(line, width, spacing, false), width, width * 1.16, phase + i + 1, false).strokePath)
  const value = Object.freeze({ ...result, decorationPaths: Object.freeze(decorationPaths) })
  cache.set(props, { signature, value })
  return value
}
