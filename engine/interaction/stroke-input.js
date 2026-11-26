import { b64Vecs } from '@tldraw/tlschema'
import { CanvasEditError } from '../errors.js'

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const same = (a, b) => distance(a, b) < 1e-9
const copy = p => ({ ...p })

function encodePath(points) {
  const safe = []
  for (const point of points) {
    if (![point.x, point.y, point.z].every(n => Number.isFinite(n) && Number.isFinite(Math.fround(n)))) throw new CanvasEditError('笔迹坐标超出可保存范围。', 'limit')
    const previous = safe.at(-1)
    // MIT b64Vecs stores the first point as Float32 and later differences as
    // Float16. A 3500 CSS px line at5% spans70000 page units, over65504.
    // Insert collinear samples before encoding, leaving rendering/scale rules
    // alone. Bound pathological jumps so malformed input cannot block a frame.
    const steps = previous ? Math.ceil(Math.max(Math.abs(point.x - previous.x), Math.abs(point.y - previous.y)) / 32752) : 1
    if (!Number.isFinite(steps) || steps > 4096) throw new CanvasEditError('本次笔迹跳跃过大，请缩小跨度后重试。', 'limit')
    for (let i = 1; previous && i < steps; i++) safe.push({ x: previous.x + (point.x - previous.x) * i / steps, y: previous.y + (point.y - previous.y) * i / steps, z: previous.z + (point.z - previous.z) * i / steps })
    safe.push(copy(point))
  }
  return b64Vecs.encodePoints(safe)
}

// 2026-11-26 isolated legacy native mouse / CDP pen observations: mouse
// samples retain z=.5; force .1/.2/.3/.4/.8/1 encoded .13/.25/.38/.5/1/1.25.
// 1.25×force rounded to two decimals is inferred from these six anchors.
// Identical spatial samples 1ms vs100ms apart produced identical paths; keep
// all samples (even .05px), and let the existing stroke geometry smooth them.
export function strokePressure(input) {
  return input.pointerType === 'pen' ? Math.round(input.pressure * 125) / 100 : .5
}

// Only input segments live here; outlining and hit testing remain shared.
export function createStrokeInput(initial, straight, existing = []) {
  const segments = existing.map(s => ({ type: s.type, points: b64Vecs.decodePoints(s.path).map(copy) }))
  let current = { type: straight ? 'straight' : 'free', points: [copy(initial)] }
  segments.push(current)
  function endpoint() { return current.points.at(-1) }
  function mode(straight) {
    const type = straight ? 'straight' : 'free'
    if (type === current.type) return
    current = { type, points: [copy(endpoint())] }; segments.push(current)
  }
  function move(point, straight) {
    mode(straight)
    if (current.type === 'straight') {
      const start = current.points[0], length = distance(start, point)
      // Legacy Shift (200,200)→(360,250) projects near15°; native Shift can
      // toggle free→straight→free during the same held stroke.
      const angle = Math.round(Math.atan2(point.y - start.y, point.x - start.x) / (Math.PI / 12)) * Math.PI / 12
      const end = { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length, z: point.z }
      if (current.points.length > 1) current.points[1] = end
      else if (!same(start, end) || start.z !== end.z) current.points.push(end)
    } else if (!same(endpoint(), point) || endpoint().z !== point.z) current.points.push(copy(point))
  }
  return { move, mode, endpoint,
    encode: () => segments.filter(s => s.points.length).map(s => ({ type: s.type, path: encodePath(s.points) })),
    closed(zoom) {
      const points = segments.flatMap(s => s.points)
      if (points.length < 4) return false
      let length = 0
      for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i])
      // Legacy m-size loop:5px closes at z=.5/1;10px doesn't. At z=2,
      // 15px closes,20px doesn't. max(8 page units,8 screen px) interpolates
      // these observations; the exact old threshold was not established.
      const threshold = Math.max(8, 8 / zoom)
      return length > threshold * 4 && distance(points[0], points.at(-1)) < threshold
    },
  }
}
