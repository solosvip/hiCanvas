import { createElement as h } from 'react';
const style = Object.freeze({
  position: 'absolute',
  left: 'var(--spacing-none)',
  top: 'var(--spacing-none)',
  transformOrigin: '0 0',
  pointerEvents: 'none'
});
const point = p => {
  if (!p || ![p.x, p.y].every(Number.isFinite)) throw new Error('吸附提示线需要有限画布坐标。');
  return Object.freeze({
    x: p.x,
    y: p.y
  });
};
export function checkedSnapGuides(item) {
  const b = item.bounds;
  if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w < 0 || b.h < 0 || !Array.isArray(item.lines)) throw new Error('吸附提示线需要有效外框和线段数组。');
  const lines = item.lines.map(line => {
    if (!line || !Array.isArray(line.points) || line.ticks !== undefined && !Array.isArray(line.ticks) || line.gap !== undefined && typeof line.gap !== 'boolean') throw new Error('吸附提示线需要锚点和刻度数组。');
    const start = point(line.start), end = point(line.end);
    if (!Number.isFinite(Math.hypot(end.x - start.x, end.y - start.y))) throw new Error('吸附提示线需要有限长度。');
    return Object.freeze({
      start,
      end,
      points: Object.freeze(line.points.map(point)),
      ticks: Object.freeze((line.ticks || []).map(point)),
      gap: Boolean(line.gap)
    });
  });
  return Object.freeze({
    kind: 'snap-guides',
    bounds: Object.freeze({
      ...b
    }),
    lines: Object.freeze(lines)
  });
}
export function SnapGuides({
  item,
  zoom
}) {
  const marks = new Map();
  for (const line of item.lines) for (const p of line.points) marks.set(`${p.x}:${p.y}`, p);
  const bar = (key, angle) => h('div', {
    key,
    style: {
      ...style,
      width: 'var(--spacing-xs)',
      height: 'var(--spacing-overlay-brush-stroke)',
      backgroundColor: 'var(--color-error)',
      transform: `rotate(${angle}rad) translate(-50%,-50%)`
    }
  });
  return h('div', {
    'data-overlay-kind': 'snap-guides',
    style
  }, item.lines.map((line, i) => {
    const dx = line.end.x - line.start.x,
      dy = line.end.y - line.start.y,
      angle = Math.atan2(dy, dx);
    return h('div', {
      key: i,
      style,
      'data-snap-measurement': line.gap || undefined
    }, h('div', {
      'data-snap-guide': '',
      style: {
        ...style,
        width: Math.hypot(dx, dy),
        height: 'var(--spacing-overlay-brush-stroke)',
        backgroundColor: 'var(--color-error)',
        transform: `translate3d(${line.start.x}px,${line.start.y}px,0) rotate(${angle}rad) scaleY(${1 / zoom}) translateY(-50%)`
      }
    }), (line.ticks || []).map((p, n) => h('div', {
      key: n,
      'data-snap-tick': '',
      style: {
        ...style,
        transform: `translate3d(${p.x}px,${p.y}px,0) scale(${1 / zoom})`
      }
    }, bar('tick', angle + Math.PI / 2))));
  }), [...marks.values()].map((p, i) => h('div', {
    key: `mark:${i}`,
    'data-snap-marker': '',
    style: {
      ...style,
      transform: `translate3d(${p.x}px,${p.y}px,0) scale(${1 / zoom})`
    }
  }, bar('a', Math.PI / 4), bar('b', -Math.PI / 4))));
}
