import { resizeTransform, resizeHandles } from './selection-transform.js';
import { framePoint, pointInFrame } from './selection-frame.js';
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
function resizePose(frame, handle, start, point, options) {
  const transform = resizeTransform(frame, handle, start, point, options),
    anchor = pointInFrame(frame, transform.origin);
  const project = p => framePoint(frame, {
    x: anchor.x + (p.x - anchor.x) * transform.scale.x,
    y: anchor.y + (p.y - anchor.y) * transform.scale.y
  });
  const corners = [[0, 0], [frame.w, 0], [frame.w, frame.h], [0, frame.h]].map(([x, y]) => project({
    x,
    y
  }));
  const x = Math.min(...corners.map(p => p.x)),
    y = Math.min(...corners.map(p => p.y)),
    [hx, hy] = resizeHandles[handle];
  return {
    box: {
      x,
      y,
      w: Math.max(...corners.map(p => p.x)) - x,
      h: Math.max(...corners.map(p => p.y)) - y
    },
    active: project({
      x: frame.w * hx,
      y: frame.h * hy
    })
  };
}
function snapResize(context, ids, frame, handle, start, point, options) {
  const pose = p => resizePose(frame, handle, start, p, options),
    original = pose(point),
    radius = screenRadius / context.read().camera.z;
  const targets = candidates(context, original.box, ids, radius);
  const dx = pose({
      x: point.x + 1,
      y: point.y
    }).active,
    dy = pose({
      x: point.x,
      y: point.y + 1
    }).active;
  const gradient = {
    x: {
      x: dx.x - original.active.x,
      y: dy.x - original.active.x
    },
    y: {
      x: dx.y - original.active.y,
      y: dy.y - original.active.y
    }
  };
  const matches = ['x', 'y'].map(axis => {
    const g = gradient[axis],
      length = g.x * g.x + g.y * g.y;
    if (length <= 1e-10 && !options.uniform) return null;
    const size = axis === 'x' ? 'w' : 'h',
      value = original.active[axis];
    const edge = Math.abs(value - original.box[axis]) < 1e-6 ? 'start' : Math.abs(value - original.box[axis] - original.box[size]) < 1e-6 ? 'end' : null;
    const aligned = nearest(original.box, targets, axis, radius, [value]),
      gap = edge && nearestGap(original.box, targets, axis, radius, edge);
    const target = gap && (!aligned || Math.abs(gap.delta) < Math.abs(aligned.delta) - 1e-9) ? gap : aligned;
    return target ? {
      axis,
      target,
      correction: length <= 1e-10 ? null : {
        x: target.delta * g.x / length,
        y: target.delta * g.y / length
      }
    } : null;
  }).filter(Boolean);
  const attempts = matches.map(m => m.correction).filter(Boolean);
  if (options.uniform) {
    // At equal x/y scale factors, max(abs(x),abs(y)) has no single Jacobian:
    // two positive finite differences would double-count the same scale. Solve
    // each candidate on the actual handle ray, preserving the initial grab offset.
    const origin = resizeTransform(frame, handle, start, point, options).origin;
    const initial = pose(start).active;
    for (const { axis, target } of matches) {
      const extent = original.active[axis] - origin[axis];
      if (Math.abs(extent) < 1e-10) continue;
      const factor = 1 + target.delta / extent;
      attempts.push({
        x: start.x + origin.x + (original.active.x - origin.x) * factor - initial.x - point.x,
        y: start.y + origin.y + (original.active.y - origin.y) * factor - initial.y - point.y,
      });
    }
  }
  if (matches.length === 2) {
    const a = gradient.x,
      b = gradient.y,
      det = a.x * b.y - a.y * b.x;
    if (Math.abs(det) > 1e-10) {
      const x = matches[0].target.delta,
        y = matches[1].target.delta;
      attempts.push({
        x: (x * b.y - a.y * y) / det,
        y: (a.x * y - x * b.x) / det
      });
    }
  }
  let best = null;
  for (const correction of attempts) {
    const next = {
        x: point.x + correction.x,
        y: point.y + correction.y
      },
      result = pose(next);
    const aligned = matches.filter(m => Math.abs(result.active[m.axis] - m.target.value) < 1e-6 && (!m.target.kind || gapMatches(result.box, m.target)));
    if (!aligned.length) continue;
    const distance = Math.hypot(correction.x, correction.y);
    if (!best || aligned.length > best.aligned.length || aligned.length === best.aligned.length && distance < best.distance) best = {
      point: next,
      result,
      aligned,
      distance
    };
  }
  return best ? {
    point: best.point,
    lines: best.aligned.flatMap(({
      axis,
      target
    }) => target.kind ? gapLines(best.result.box, target) : [alignment(best.result.box, target.target, axis, target.value)])
  } : {
    point,
    lines: []
  };
}
export function createObjectSnapping(context) {
  return {
    resize: (...args) => snapResize(context, ...args),
    move(starts, delta, input) {
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
      const correction = {
          x: x?.delta || 0,
          y: y?.delta || 0
        },
        snapped = shifted(proposed, correction);
      const lines = [['x', x], ['y', y]].flatMap(([axis, result]) => !result ? [] : result.kind ? gapLines(snapped, result) : [alignment(snapped, result.target, axis, result.value)]);
      return {
        delta: {
          x: delta.x + correction.x,
          y: delta.y + correction.y
        },
        lines
      };
    }
  };
}
