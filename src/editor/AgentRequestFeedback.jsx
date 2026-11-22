import { useEffect } from 'react'
import { useToasts } from 'tldraw'
import { canvasApiUrl } from '../conversations/client.js'

// 非占位框操作（如图片转网页）同样要让用户看到请求有没有交到 Agent。
export function AgentRequestFeedback() {
  const { addToast, removeToast } = useToasts()
  useEffect(() => {
    let disposed = false
    const shown = new Map()
    async function refresh() {
      try {
        const response = await fetch(canvasApiUrl('/api/agent/requests'), { headers: { 'x-hicanvas-client': '1' } })
        if (!response.ok) return
        const { requests } = await response.json()
        if (disposed) return
        for (const request of requests.slice(-20)) {
          const state = `${request.status}/${request.delivery?.status}`
          if (shown.get(request.id) === state) continue
          const initial = !shown.has(request.id)
          shown.set(request.id, state)
          if (initial && ['completed', 'failed'].includes(request.status)) continue
          const waiting = request.status === 'pending' && request.delivery?.status === 'waiting'
          const done = request.status === 'completed'
          const failed = request.status === 'failed'
          const id = `hicanvas-request-${request.id}`
          removeToast(id)
          addToast({ id, title: failed ? '画板任务未完成' : done ? '画板任务已完成' : waiting ? '等待 Agent 连接' : request.status === 'working' ? 'Agent 正在制作' : '画板请求已发送',
            description: request.message || (waiting ? '请求已保存在本对话。从 REX 中让 Agent 重新连接这个画板，即可继续处理。' : done ? '结果已返回画板。' : '可继续编辑画板，结果会回到本对话。'),
            severity: failed ? 'error' : 'info', keepOpen: waiting || failed })
        }
      } catch { /* 保存错误由持久化反馈统一提示，不重复刷屏。 */ }
    }
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [addToast, removeToast])
  return null
}
