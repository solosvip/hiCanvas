import assert from 'node:assert/strict'

export function measureOpaqueCoverage(colors) {
  assert.equal(colors.length, 4)
  assert.ok(colors.every(color => color.length === 4 && color.every(value => Number.isInteger(value) && value >= 0 && value <= 255)))
  const [black, white, black2, white2] = colors
  const equal = (a, b) => a.every((value, i) => value === b[i])
  const stable = equal(black, black2) && equal(white, white2)
  const response = white.slice(0, 3).map((value, i) => value - black[i])
  const minimum = Math.min(...response), maximum = Math.max(...response)
  const validResponse = stable && colors.every(color => color[3] === 255) && minimum >= 0 && maximum > 0 && maximum - minimum <= 1
  return { stable, response, coverageEstimate: response.reduce((sum, value) => sum + value, 0) / (3 * 255), coverageBounds: [minimum / 255, maximum / 255], partial: validResponse && maximum < 255 }
}

export function opaqueEdgeDistance(bounds, x, y) {
  const dx = Math.max(bounds.x - x, x - bounds.x - bounds.width, 0)
  const dy = Math.max(bounds.y - y, y - bounds.y - bounds.height, 0)
  return dx || dy ? Math.hypot(dx, dy) : Math.min(x - bounds.x, bounds.x + bounds.width - x, y - bounds.y, bounds.y + bounds.height - y)
}

// Main's 2335 04:4x ruling, v67-margin-experiment-cycles/ownership.json:
// Only measured partial coverage within 1 CSS px of the actual SVG edge can
// receive one level. Full ink/background stay exact; A/A grants no permission.
export function classifyOpaqueEdges({ before, clipped, regions, proofs, scale }) {
  const { width, height } = before
  assert.ok(width > 0 && height > 0 && Number.isFinite(scale) && scale > 0)
  assert.equal(before.bytes.length, width * height * 4)
  assert.equal(clipped.width, width); assert.equal(clipped.height, height)
  assert.equal(clipped.bytes.length, before.bytes.length)
  assert.equal(regions.mask.length, width * height)
  const mask = regions.mask.slice(), details = [], seen = new Set()
  for (const { x, y, shape, states } of proofs) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height)
    const pixel = y * width + x, offset = pixel * 4
    assert.ok(!seen.has(pixel), '不透明边缘不能重复归属')
    seen.add(pixel)
    const bounds = shape.bounds
    assert.ok(shape.id && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) && bounds.width > 0 && bounds.height > 0)
    assert.equal(states.length, 2)
    const coverage = states.map(state => ({ clipped: state.clipped, ...measureOpaqueCoverage(state.colors) }))
    const distanceCss = opaqueEdgeDistance(bounds, x / scale, y / scale)
    const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(before.bytes[offset + channel] - clipped.bytes[offset + channel])))
    const sourceFits = states.every(state => {
      const source = state.clipped ? clipped.bytes : before.bytes
      // Electron bitmaps are BGRA; the response evidence is explicitly RGBA.
      return source[offset + 3] === 255 && [0, 1, 2].every(channel => source[offset + 2 - channel] >= state.colors[0][channel] - 1 && source[offset + 2 - channel] <= state.colors[1][channel] + 1)
    })
    const bothModes = states.some(state => state.clipped === false) && states.some(state => state.clipped === true)
    const allowed = shape.opacity === 1 && mask[pixel] === 0 && delta === 1 && distanceCss <= 1 && bothModes && sourceFits && coverage.every(state => state.partial)
    if (allowed) mask[pixel] = 3
    details.push({ x, y, cssX: x / scale, cssY: y / scale, owner: shape.id, opacity: shape.opacity, bounds, distanceCss, delta, coverage, sourceFits, allowed })
  }
  return { mask, details }
}
