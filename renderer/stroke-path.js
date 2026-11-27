const paths = new WeakMap()

// Explicit SVG commands delimit coordinates; spaces before L/Z carry no geometry.
// Cache only deeply frozen point arrays produced by shared stroke geometry.
// External mutable arrays retain the original recompute-on-call behavior.
export function strokePath(points) {
  const before = paths.get(points)
  if (before !== undefined) return before
  const value = points.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y}`).join('') + 'Z'
  if (Object.isFrozen(points) && points.every(point => Object.isFrozen(point))) paths.set(points, value)
  return value
}
