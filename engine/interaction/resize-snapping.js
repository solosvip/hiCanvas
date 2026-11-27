import { resizeTransform, resizeHandles } from './selection-transform.js';
import { framePoint, pointInFrame } from './selection-frame.js';

// Shared transform solver: strategies choose targets, the existing resize rules
// continue to own fixed edges, centre/aspect constraints and reflections.
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
export function snapResize(frame, handle, start, point, options, prepare) {
  const pose = p => resizePose(frame, handle, start, p, options),
    original = pose(point);
  const resolve = prepare(original);
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
    const target = resolve(axis, value, edge);
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
    const aligned = matches.filter(m => Math.abs(result.active[m.axis] - m.target.value) < 1e-6 && (!m.target.accept || m.target.accept(result.box)));
    if (!aligned.length) continue;
    const distance = Math.hypot(correction.x, correction.y), score = aligned.length;
    if (!best || score > best.score || score === best.score && distance < best.distance) best = {
      point: next,
      result,
      aligned,
      score,
      distance
    };
  }
  return best ? { point: best.point, aligned: best.aligned, box: best.result.box } : { point, aligned: [], box: original.box };
}
