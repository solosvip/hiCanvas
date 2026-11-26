// Legacy native creation starts with a 1x1 seed at the pointer-down point.
// Alt keeps that seed's center, so (+150,+80) becomes 299x159, whereas
// (-150,-80) becomes 301x161. Shift equalizes the signed seed scales.
export function draggedCreationBounds(start, point, input, frame = false) {
  let x = point.x - start.x, y = point.y - start.y
  if (input.altKey) { x = x * 2 - 1; y = y * 2 - 1 }
  if (input.shiftKey) {
    const size = Math.max(Math.abs(x), Math.abs(y))
    x = (x < 0 ? -1 : 1) * size; y = (y < 0 ? -1 : 1) * size
  }
  const w = Math.max(1, Math.abs(x)), h = Math.max(1, Math.abs(y))
  return input.altKey
    ? { x: start.x + .5 - w / 2, y: start.y + .5 - h / 2, w, h }
    : { x: start.x + (x < 0 || frame && x === 0 ? -w : 0), y: start.y + (y < 0 || frame && y === 0 ? -h : 0), w, h }
}
