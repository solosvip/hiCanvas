// Find neighbours separately in every shared orthogonal band. A reference in
// another row must not interrupt this row's gaps. Sweep interval edges and keep
// active axis order in a Fenwick tree: O(n log n), never all reference pairs.
export function gapPairs(box, targets, axis) {
  const other = axis === 'x' ? 'y' : 'x';
  const size = axis === 'x' ? 'w' : 'h';
  const otherSize = axis === 'x' ? 'h' : 'w';
  const ordered = targets.filter(t => Math.min(t[other] + t[otherSize], box[other] + box[otherSize]) > Math.max(t[other], box[other]))
    .sort((a, b) => a[axis] - b[axis] || a[size] - b[size] || a.id.localeCompare(b.id));
  const events = ordered.flatMap((target, i) => [
    { at: Math.max(target[other], box[other]), i, delta: 1 },
    { at: Math.min(target[other] + target[otherSize], box[other] + box[otherSize]), i, delta: -1 },
  ]).sort((a, b) => a.at - b.at || a.delta - b.delta || a.i - b.i);
  const tree = new Uint32Array(ordered.length + 1), active = new Uint8Array(ordered.length), pairs = new Map();
  function add(index, delta) {
    for (let i = index + 1; i < tree.length; i += i & -i) tree[i] += delta;
  }
  function count(end) {
    let result = 0;
    for (let i = end; i > 0; i -= i & -i) result += tree[i];
    return result;
  }
  function kth(rank) {
    let index = 0;
    for (let step = 2 ** Math.floor(Math.log2(ordered.length || 1)); step; step = Math.floor(step / 2)) {
      const next = index + step;
      if (next < tree.length && tree[next] < rank) { index = next; rank -= tree[next]; }
    }
    return index;
  }
  function remember(left, right, at) {
    if (left === null || right === null) return;
    const a = ordered[left], b = ordered[right];
    const end = Math.min(a[other] + a[otherSize], b[other] + b[otherSize], box[other] + box[otherSize]);
    if (end > at && a[axis] + a[size] <= b[axis]) pairs.set(`${left}:${right}`, [left, right]);
  }
  for (let position = 0; position < events.length;) {
    const at = events[position].at, affected = new Set();
    // Touching interval ends share no positive band. Apply ALL events at the
    // same coordinate before recording neighbours, never a transient seam gap.
    do {
      const event = events[position++];
      add(event.i, event.delta); active[event.i] = Number(event.delta > 0);
      affected.add(event.i);
      const before = count(event.i), total = count(ordered.length);
      if (before) affected.add(kth(before));
      const next = before + 1 + active[event.i];
      if (next <= total) affected.add(kth(next));
    } while (position < events.length && events[position].at === at);
    const total = count(ordered.length);
    for (const i of affected) if (active[i]) {
      const next = count(i + 1) + 1;
      if (next <= total) remember(i, kth(next), at);
    }
  }
  return [...pairs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([a, b]) => [ordered[a], ordered[b]]);
}
