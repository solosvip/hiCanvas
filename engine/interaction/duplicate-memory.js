const sameIds = (a, b) => a.length === b.length && a.every(id => b.includes(id))

// Session-only receipts: no selection, repeat offset or ID correspondence is
// written to the document or the host's undo history (ADR 0010).
export function createDuplicateMemory(index) {
  let last = null
  const receipts = []
  return {
    checkpoint() { const previous = last; return () => { last = previous } },
    selectionChanged(ids) { if (last && !sameIds(ids, last.copies)) last = null },
    offset(ids) {
      if (last && sameIds(ids, last.copies)) return { ...last.offset }
      const bounds = ids.map(id => index.getBounds(id)).filter(Boolean)
      // 2026-11-26 isolated legacy, native Mod+D: a 100-wide rectangle advances
      // (110,0), repeats at 220/330; z=2 is unchanged. A 500-wide selection
      // advances (510,0). Moving/nudging a copy retains the previous offset.
      return { x: bounds.length ? Math.max(...bounds.map(b => b.x + b.w)) - Math.min(...bounds.map(b => b.x)) + 10 : 10, y: 0 }
    },
    remember(sources, idMap, offset) {
      const copies = sources.map(id => idMap[id]).filter(Boolean)
      last = { sources: [...sources], copies, offset: { ...offset } }
      receipts.push(last)
      return copies
    },
    followHistory(changes, selected) {
      // Follow this session's own copy IDs when undo removes / redo recreates
      // them. This derives selection from the receipt, never from saved UI data.
      const receipt = receipts.findLast(r => sameIds(selected, r.copies) && r.copies.every(id => changes.removed[id]) || sameIds(selected, r.sources) && r.copies.every(id => changes.added[id]))
      if (!receipt) return null
      const redo = receipt.copies.every(id => changes.added[id]), ids = redo ? receipt.copies : receipt.sources
      last = redo ? receipt : receipts.findLast(r => sameIds(r.copies, ids)) || null
      return ids
    },
  }
}
