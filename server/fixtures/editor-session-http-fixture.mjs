// 测试宿主适配器：HTTP/SSE 留在运行时之外，只连接隔离测试创建的本机服务。
export function httpSessionTransport(base, conversationId) {
  const query = `?conversation=${encodeURIComponent(conversationId)}`
  let readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const commits = []
  async function request(path, method = 'GET', body, actor) {
    const response = await fetch(base + path + query, {
      method, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', ...(actor && { 'X-HiCanvas-Actor': actor }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(result.error), { code: response.status === 409 ? 'conflict' : 'transport' })
    return result
  }
  return {
    ready, commits,
    read: () => request('/api/canvas'),
    commit({ expectedRevision, commands, actor }) {
      commits.push({ expectedRevision, commands: structuredClone(commands), actor })
      return request('/api/canvas/operations', 'POST', { expectedRevision, operations: commands }, actor)
    },
    subscribe(onChange) {
      const controller = new AbortController()
      void (async () => {
        const response = await fetch(base + '/api/canvas-events' + query, { signal: controller.signal })
        if (!response.ok) throw new Error(`订阅失败：${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          pending += decoder.decode(value, { stream: true })
          let end
          while ((end = pending.indexOf('\n\n')) !== -1) {
            const frame = pending.slice(0, end)
            pending = pending.slice(end + 2)
            if (!frame.startsWith('event: canvas-changed\n')) continue
            const data = JSON.parse(frame.split('\ndata: ')[1])
            if (data.connected) readyResolve()
            else onChange(data)
          }
        }
      })().catch(error => { if (!controller.signal.aborted) readyReject(error) })
      return () => controller.abort()
    },
  }
}
