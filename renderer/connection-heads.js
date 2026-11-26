import { add, mul, pathOf } from './connection-path.js'
import { CONNECTION_METRICS as m } from './connection-metrics.js'

export function arrowHead(kind, tip, inward, length) {
  const normal = { x: -inward.y, y: inward.x }
  const at = (x, y) => add(tip, add(mul(inward, x), mul(normal, y)))
  if (kind === 'none' || kind === 'pipe' || !length) return null // pipe has no extra cap in observed legacy output.
  if (kind === 'dot') {
    const radius = length * m.dotFactor, center = at(radius, 0)
    const points = Array.from({ length: 64 }, (_, i) => add(center, { x: Math.cos(i * Math.PI / 32) * radius, y: Math.sin(i * Math.PI / 32) * radius }))
    return { kind, d: pathOf(points, true), points, closed: true }
  }
  let points, closed = true
  const back = length * Math.cos(m.headHalfAngle), half = length * Math.sin(m.headHalfAngle)
  if (kind === 'arrow') { points = [at(back, half), tip, at(back, -half)]; closed = false }
  else if (kind === 'triangle') points = [at(back, half), at(back, -half), tip]
  else if (kind === 'square') { const size = length * m.squareFactor; points = [at(0, size / 2), at(size, size / 2), at(size, -size / 2), at(0, -size / 2)] }
  else if (kind === 'diamond') { const size = length * m.diamondFactor; points = [tip, at(size, size), at(size * 2, 0), at(size, -size)] }
  else if (kind === 'inverted') points = [at(0, half), at(length, 0), at(0, -half)]
  else if (kind === 'bar') { points = [at(0, half), at(0, -half)]; closed = false }
  else return null
  return { kind, d: pathOf(points, closed), points, closed }
}
