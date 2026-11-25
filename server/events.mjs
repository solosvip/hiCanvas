const eventsByWorkspace = new WeakMap()
export function getCanvasEvents(workspace) {
  if (!eventsByWorkspace.has(workspace)) eventsByWorkspace.set(workspace, createCanvasEvents())
  return eventsByWorkspace.get(workspace)
}
export function createCanvasEvents() {
  const clients = new Map()
  return {
    deleted(result) {
      for (const client of clients.get(result.conversationId) || []) {
        try { client.write(`event: canvas-deleted\ndata: ${JSON.stringify(result)}\n\n`); client.end() } catch { /* 连接关闭时清理。 */ }
      }
    },
    subscribe(id, req, res) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write('event: canvas-changed\ndata: {"connected":true}\n\n')
      const group = clients.get(id) || new Set()
      clients.set(id, group)
      group.add(res)
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000)
      req.on('close', () => { clearInterval(heartbeat); group.delete(res); if (!group.size) clients.delete(id) })
    },
    broadcast(result) {
      const payload = { conversationId: result.conversationId, revision: result.revision, updatedAt: result.updatedAt }
      for (const client of clients.get(result.conversationId) || []) {
        try { client.write(`event: canvas-changed\ndata: ${JSON.stringify(payload)}\n\n`) } catch { /* 连接关闭时由 close 清理。 */ }
      }
    }
  }
}
