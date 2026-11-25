import { canvasApiUrl } from './conversations/client.js'

export async function sendCanvasAgentRequest(message, context = {}) {
  const match = message.prompt.match(/(?:holder shape:|Slides frame:|draftShapeId:)\s*"?(shape:[\w-]+)/i)
  const response = await fetch(canvasApiUrl('/api/agent/requests'), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' },
    body: JSON.stringify({ ...message, clientRequestId: crypto.randomUUID(), context: { ...context, ...(match ? { targetShapeId: match[1] } : {}) } })
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '请求未能提交到画板服务。')
  return result
}
