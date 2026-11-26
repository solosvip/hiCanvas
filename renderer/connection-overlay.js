import { createElement as h } from 'react'

const style = Object.freeze({ position: 'absolute', left: 'var(--spacing-none)', top: 'var(--spacing-none)', transformOrigin: '0 0' })
export function ConnectionOverlay({ item, zoom }) {
  return h('div', { 'data-overlay-kind': item.kind, 'data-overlay-id': item.id, style }, item.handles.map(handle => h('div', {
    key: handle.id, [item.kind === 'note' ? 'data-note-handle' : 'data-connection-handle']: handle.id, 'data-connection-kind': handle.kind,
    style: { ...style, width: 'var(--spacing-overlay-handle-size)', height: 'var(--spacing-overlay-handle-size)',
      borderRadius: 'var(--radius-full)', boxSizing: 'border-box',
      border: 'var(--spacing-overlay-handle-stroke) solid var(--color-primary)',
      backgroundColor: item.kind === 'snap' ? 'var(--color-primary)' : 'var(--color-surface)',
      transform: `translate3d(${handle.x}px,${handle.y}px,0) scale(${1 / zoom}) translate(-50%,-50%)` },
  }, item.kind === 'note' && [false, true].map(vertical => h('div', { key: String(vertical), style: { ...style, left: '50%', top: '50%', width: vertical ? 'var(--spacing-overlay-handle-stroke)' : 'var(--spacing-overlay-rotate-radius)', height: vertical ? 'var(--spacing-overlay-rotate-radius)' : 'var(--spacing-overlay-handle-stroke)', backgroundColor: 'var(--color-primary)', transform: 'translate(-50%,-50%)' } })))))
}

export function checkedConnectionOverlay(item) {
  if (!item.bounds || ![item.bounds.x, item.bounds.y, item.bounds.w, item.bounds.h].every(Number.isFinite) || item.bounds.w < 0 || item.bounds.h < 0 || !Array.isArray(item.handles) || item.handles.some(handle => !handle || typeof handle.id !== 'string' || !['vertex', 'create', 'bend', 'elbow'].includes(handle.kind) || ![handle.x, handle.y].every(Number.isFinite))) throw new Error('连接线覆盖层需要有效的控制点。')
  return Object.freeze({ kind: item.kind, ...(typeof item.id === 'string' && { id: item.id }), bounds: Object.freeze({ ...item.bounds }), handles: Object.freeze(item.handles.map(handle => Object.freeze({ ...handle }))) })
}
