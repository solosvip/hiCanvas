// 2026-11-25 对照运行中的旧版画面测量：合成线、圆点及压力 0.1/0.5/1，
// 4x 相机、2x 截图；只观察像素和计算后的绘制属性，未读取 SVG 路径。
export const INK_WIDTHS = Object.freeze({ s: 3, m: 4.5, l: 6, xl: 11 })
export const HIGHLIGHT_WIDTHS = Object.freeze({ s: 20.16, m: 26.88, l: 40.32, xl: 49.28 })
const penWidths = { s: [2.75, 5.25, 7.875], m: [3.75, 7.25, 11.125], l: [4.875, 9.375, 14.125], xl: [8.375, 16.25, 24.375] }
const dots = { s: 4.125, m: 6.125, l: 8.375, xl: 16.25 }
const slowWidths = { s: 2.4, m: 4, l: 7.1, xl: 16.8 }

// Independent interpolation of measured anchors. Mouse speed is inferred from
// point spacing, since the persisted records contain no timestamps. This is a
// visual approximation, not a reproduction of the legacy hand-drawn algorithm.
export function strokeRadii(shape, points, spacing) {
  const p = shape.props, size = Object.hasOwn(INK_WIDTHS, p.size) ? p.size : 'm', scale = Math.abs(p.scale || 1)
  const width = INK_WIDTHS[size]
  if (shape.type === 'highlight') return points.map(() => HIGHLIGHT_WIDTHS[size] * scale / 2)
  if (p.dash !== 'draw') return points.map(() => width * scale / 2)
  if (points.length === 1 && !p.isPen) return [dots[size] * scale / 2]
  let travelled = 0
  return points.map((point, i) => {
    let measured
    if (p.isPen) {
      const pressure = Math.max(0, Math.min(1, point.z ?? 0.5)), values = penWidths[size]
      measured = pressure <= 0.5 ? values[0] + (values[1] - values[0]) * (pressure - 0.1) / 0.4 : values[1] + (values[2] - values[1]) * (pressure - 0.5) / 0.5
    } else {
      if (i) travelled += Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y)
      const speed = Math.max(0, Math.min(1, (spacing - 4) / 40))
      measured = slowWidths[size] * (1 - speed) + width * 0.93 * speed
      measured += (dots[size] - measured) * Math.exp(-travelled / (width * 3))
    }
    return Math.max(width * 0.05, measured) * scale / 2
  })
}
