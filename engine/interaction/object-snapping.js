import { gapPairs } from './gap-pairs.js';

// Opaque legacy runtime, synthetic rectangles, native Electron input on
// 2026-11-26: zoom .5/1/2 accepts 8 CSS px and rejects 9. Fractional
// target bounds accept 7.99/8 and reject 8.01/8.25; resize agrees at 8/8.01.
const screenRadius = 8;
const visibleAnchor = (b, axis, value) => !b.visible || value >= b.visible[axis] - 1e-9 && value <= b.visible[axis] + b.visible[axis === 'x' ? 'w' : 'h'] + 1e-9;
const anchors = (b, axis) => [b[axis], b[axis] + b[axis === 'x' ? 'w' : 'h'] / 2, b[axis] + b[axis === 'x' ? 'w' : 'h']].filter(value => visibleAnchor(b, axis, value));
const shifted = (b, delta) => ({
  ...b,
  x: b.x + delta.x,
  y: b.y + delta.y
});
export function unionBounds(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  const x = Math.min(...valid.map(b => b.x)),
    y = Math.min(...valid.map(b => b.y));
  return {
    x,
    y,
    w: Math.max(...valid.map(b => b.x + b.w)) - x,
    h: Math.max(...valid.map(b => b.y + b.h)) - y
  };
}
function candidates(context, box, ids, radius) {
  const {
      camera,
      viewport
    } = context.read(),
    excluded = new Set(ids),
    parents = new Set();
  for (const id of ids) for (let r = context.index.getRecord(id); r?.typeName === 'shape'; r = context.index.getRecord(r.parentId)) parents.add(r.id);
  const view = viewport ? {
    x: -camera.x,
    y: -camera.y,
    w: viewport.w / camera.z,
    h: viewport.h / camera.z
  } : box;
  const area = unionBounds([box, view]),
    found = new Set();
  function query(b) {
    // Tile the crossing alignment bands. A huge low-zoom rectangle would trigger
    // the index's full-record fallback; each tile stays below its cell budget.
    for (let x = b.x; x <= b.x + b.w; x += 2048) for (let y = b.y; y <= b.y + b.h; y += 2048) for (const id of context.index.query({
      x,
      y,
      w: Math.min(2048, b.x + b.w - x),
      h: Math.min(2048, b.y + b.h - y)
    })) found.add(id);
  }
  // Gap references may sit between the moving object's three anchors. Query
  // the full orthogonal span too, rather than dropping narrow overlapping rows.
  query({
    x: box.x - radius,
    y: area.y - radius,
    w: box.w + radius * 2,
    h: area.h + radius * 2
  });
  query({
    x: area.x - radius,
    y: box.y - radius,
    w: area.w + radius * 2,
    h: box.h + radius * 2
  });
  const result = [];
  for (const id of found) {
    if (parents.has(id)) continue;
    let own = false;
    for (let r = context.index.getRecord(id); r?.typeName === 'shape'; r = context.index.getRecord(r.parentId)) if (excluded.has(r.id)) {
      own = true;
      break;
    }
    const b = !own && context.index.getBounds(id);
    if (b) result.push({
      id,
      ...b,
      visible: context.index.getVisibleBounds(id),
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
function nearest(box, targets, axis, radius, allowed = anchors(box, axis)) {
  let best = null;
  for (const source of allowed) for (const target of targets) for (const value of anchors(target, axis)) {
    const delta = value - source;
    if (Math.abs(delta) <= radius + 1e-9 && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9)) best = {
      delta,
      target,
      source,
      value
    };
  }
  return best;
}
function alignment(box, target, axis, value) {
  const other = axis === 'x' ? 'y' : 'x',
    size = axis === 'x' ? 'h' : 'w';
  const positions = [box[other], box[other] + box[size], target[other], target[other] + target[size]];
  const point = v => ({
    [axis]: value,
    [other]: v
  });
  return {
    start: point(Math.min(...positions)),
    end: point(Math.max(...positions)),
    points: [...new Set(positions)].map(point)
  };
}
function nearestGap(box, targets, axis, radius, edge = null) {
  const size = axis === 'x' ? 'w' : 'h';
  let best = null;
  for (const [a, b] of gapPairs(box, targets, axis)) {
    const gap = b[axis] - a[axis] - a[size];
    if (!visibleAnchor(a, axis, a[axis] + a[size]) || !visibleAnchor(b, axis, b[axis])) continue;
    const proposals = edge === 'end' ? [['before', a[axis] - gap]] : edge === 'start' ? [['after', b[axis] + b[size] + gap]] : [['before', a[axis] - gap - box[size]], ['after', b[axis] + b[size] + gap]];
    if (gap >= box[size]) proposals.push(['between', edge === 'end' ? b[axis] - box[axis] + a[axis] + a[size] : edge === 'start' ? a[axis] + a[size] + b[axis] - box[axis] - box[size] : (a[axis] + a[size] + b[axis] - box[size]) / 2]);
    for (const [kind, start] of proposals) {
      if (kind === 'before' && !visibleAnchor(a, axis, a[axis]) || kind === 'after' && !visibleAnchor(b, axis, b[axis] + b[size])) continue;
      const delta = start - box[axis] - (edge === 'end' ? box[size] : 0);
      if (Math.abs(delta) <= radius + 1e-9 && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9)) best = {
        delta,
        value: start,
        kind,
        a,
        b,
        axis
      };
    }
  }
  return best;
}
function gapMatches(box, {
  a,
  b,
  kind,
  axis
}) {
  const size = axis === 'x' ? 'w' : 'h',
    gap = b[axis] - a[axis] - a[size];
  const error = kind === 'before' ? box[axis] + box[size] - a[axis] + gap : kind === 'after' ? box[axis] - b[axis] - b[size] - gap : box[axis] - a[axis] - a[size] - b[axis] + box[axis] + box[size];
  return Math.abs(error) < 1e-6;
}
function gapLines(box, {
  a,
  b,
  kind,
  axis
}) {
  const other = axis === 'x' ? 'y' : 'x',
    size = axis === 'x' ? 'w' : 'h',
    otherSize = axis === 'x' ? 'h' : 'w';
  const coordinate = (Math.max(a[other], b[other], box[other]) + Math.min(a[other] + a[otherSize], b[other] + b[otherSize], box[other] + box[otherSize])) / 2;
  const point = value => ({
    [axis]: value,
    [other]: coordinate
  });
  const ranges = kind === 'before' ? [[box[axis] + box[size], a[axis]], [a[axis] + a[size], b[axis]]] : kind === 'after' ? [[a[axis] + a[size], b[axis]], [b[axis] + b[size], box[axis]]] : [[a[axis] + a[size], box[axis]], [box[axis] + box[size], b[axis]]];
  return ranges.map(([from, to]) => ({
    gap: true,
    start: point(from),
    end: point(to),
    points: [point(from), point(to)],
    ticks: [point((from + to) / 2)]
  }));
}
function match(box, targets, axis, radius) {
  const aligned = nearest(box, targets, axis, radius),
    gap = nearestGap(box, targets, axis, radius);
  return gap && (!aligned || Math.abs(gap.delta) < Math.abs(aligned.delta) - 1e-9) ? gap : aligned;
}
export function createObjectSnapping(context) {
  return {
    resizeTargets(ids, box) {
      const radius = screenRadius / context.read().camera.z;
      const targets = candidates(context, box, ids, radius);
      return (axis, value, edge) => {
        const aligned = nearest(box, targets, axis, radius, [value]);
        const gap = edge && nearestGap(box, targets, axis, radius, edge);
        const target = gap && (!aligned || Math.abs(gap.delta) < Math.abs(aligned.delta) - 1e-9) ? gap : aligned;
        return target?.kind ? { ...target, accept: result => gapMatches(result, target) } : target;
      };
    },
    resizeLines(result) {
      return result.aligned.flatMap(({ axis, target }) => target.kind ? gapLines(result.box, target) : target.target ? [alignment(result.box, target.target, axis, target.value)] : []);
    },
    move(starts, delta, input, fallback = delta) {
      const box = unionBounds(starts.map(s => s.bounds)),
        radius = screenRadius / context.read().camera.z;
      if (!box) return {
        delta,
        lines: []
      };
      const proposed = shifted(box, delta),
        targets = candidates(context, proposed, starts.map(s => s.id), radius);
      const locked = input.shiftKey ? Math.abs(delta.x) > Math.abs(delta.y) ? 'y' : 'x' : null;
      const x = locked === 'x' ? null : match(proposed, targets, 'x', radius),
        y = locked === 'y' ? null : match(proposed, targets, 'y', radius);
      const next = { x: x ? delta.x + x.delta : fallback.x, y: y ? delta.y + y.delta : fallback.y },
        snapped = shifted(box, next);
      const lines = [['x', x], ['y', y]].flatMap(([axis, result]) => !result ? [] : result.kind ? gapLines(snapped, result) : [alignment(snapped, result.target, axis, result.value)]);
      return {
        delta: next,
        lines
      };
    }
  };
}
