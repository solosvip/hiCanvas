import { createElement as h } from 'react'

const labels = Object.freeze({ queued: '排队中', running: '正在生成', pending: '已发送至 Agent', working: 'Agent 正在制作', waiting: '等待 Agent 连接', failed: '生成失败', interrupted: '生成已中断', saved: '图片已保存' })

export function FrameState({ shape }) {
  const task = shape.meta?.hicanvasGeneration
  if (typeof task?.status !== 'string' || !Object.hasOwn(labels, task.status)) return null
  const title = labels[task.status]
  return h('div', { 'data-generation-status': task.status, role: 'status', 'aria-live': 'polite', style: { position: 'absolute', inset: 0, pointerEvents: 'none', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--spacing-md)', padding: 'var(--spacing-xl)', overflow: 'hidden', overflowWrap: 'anywhere', textAlign: 'center', color: 'var(--color-on-surface)', fontFamily: 'var(--font-body-md)', fontSize: 'var(--text-body-md)' } },
    h('span', null, title), typeof task.error === 'string' && task.error ? h('small', { style: { fontSize: 'var(--text-label-md)', color: 'var(--color-error)' } }, task.error) : null)
}
