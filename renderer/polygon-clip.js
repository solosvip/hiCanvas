// Sutherland–Hodgman clipping against a convex, counter-clockwise polygon.
// Rectangle transforms preserve orientation. All points are in canvas units.
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
export function clipPolygon(subject, clip) {
  let result = subject
  for (let i = 0; i < clip.length && result.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], input = result
    result = []
    for (let j = 0; j < input.length; j++) {
      const previous = input[(j + input.length - 1) % input.length], current = input[j]
      const before = cross(a, b, previous), after = cross(a, b, current)
      const wasInside = before >= -1e-9, inside = after >= -1e-9
      if (wasInside !== inside) {
        const t = before / (before - after)
        result.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t })
      }
      if (inside) result.push(current)
    }
  }
  return result
}
export const boxPolygon = box => [
  { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y },
  { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h },
]
