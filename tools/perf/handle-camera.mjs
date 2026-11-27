import { benchmarkViewport } from './config.mjs'

export function handleCamera(bounds) {
  if (!bounds || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(bounds[key])) || bounds.w <= 0 || bounds.h <= 0) throw new Error('手柄目标外框无效。')
  // 96×72 becomes 144×108 CSS px. The old fit-all ~8px target could hit
  // overlapping handle regions and start a move rather than a resize (#90).
  const z = Math.max(1.5, 100 / Math.min(bounds.w, bounds.h))
  return { x: benchmarkViewport.width / (2 * z) - bounds.x - bounds.w / 2,
    y: benchmarkViewport.height / (2 * z) - bounds.y - bounds.h / 2, z }
}

export function assertHandleRestored(before, final) {
  if (final.mode !== 'idle' || final.submitting || final.commitCalls !== before.commitCalls || final.revision !== before.revision
    || !final.shape || ['x', 'y', 'w', 'h'].some(key => !Number.isFinite(final.shape[key]) || Math.abs(final.shape[key] - before[key]) > 1e-7)
    || ['x', 'y', 'z'].some(key => !Number.isFinite(final.camera?.[key]) || Math.abs(final.camera[key] - before.camera[key]) > 1e-7)) throw new Error('手柄取消没有恢复未提交的原几何与相机。')
}
