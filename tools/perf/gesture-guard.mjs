export function assertGesturePreview(before, during, name) {
  if (before.transport !== 'memory' || during.transport !== 'memory' || !Number.isInteger(before.commitCalls) || !Number.isInteger(during.commitCalls)) throw new Error('缺少隔离内存提交观察。')
  if (during.commitCalls !== before.commitCalls || during.revision !== before.revision || during.submitting) throw new Error('手势途中发生提交。')
  if (during.snapshotReads !== before.snapshotReads) throw new Error('手势途中读取了整份快照。')
  if (name === 'drag' && (during.mode !== 'dragging' || !during.selected || during.selectedIds.length !== 1)) throw new Error('原生输入没有进入单目标拖动。')
  if (name === 'drag' && (before.shape.w !== during.shape.w || before.shape.h !== during.shape.h || before.shape.rotation !== during.shape.rotation)) throw new Error('拖动意外变形。')
  if (name !== 'drag' && (before.shape.x !== during.shape.x || before.shape.y !== during.shape.y)) throw new Error('视角操作移动了目标。')
}

export function assertGestureCommitted(before, after, during, expectedDelta) {
  if (after.commitCalls !== before.commitCalls + 1 || after.revision === before.revision || after.submitting || after.mode !== 'idle') throw new Error('松手没有恰好提交一次完整手势。')
  if (!after.shape || !['x', 'y', 'w', 'h', 'rotation'].every(key => Number.isFinite(after.shape[key]))) throw new Error('松手后目标几何无效。')
  if (Math.hypot(after.shape.x - before.shape.x, after.shape.y - before.shape.y) <= 1) throw new Error('松手后丢失实际拖动结果。')
  if (['w', 'h', 'rotation'].some(key => after.shape[key] !== before.shape[key])) throw new Error('松手后目标被变形。')
  if (during && expectedDelta) for (const key of ['x', 'y']) {
    const preview = during.shape[key] - before.shape[key], actual = after.shape[key] - before.shape[key]
    if (actual < Math.min(preview, expectedDelta[key]) - 1e-6 || actual > Math.max(preview, expectedDelta[key]) + 1e-6) throw new Error('松手后的位移不在最后预览与松手输入之间。')
  }
}
