import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createCanvasMiddleware } from './routes.mjs'
import { createConversations } from './conversations.mjs'
import { createImageMiddleware } from './image-routes.mjs'

export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hicanvas-conversations-'))
  const workspace = createConversations(root)
  const canvas = createCanvasMiddleware({ workspace, settingsDir: join(root, 'settings') })
  const images = createImageMiddleware({ workspace, settingsDir: join(root, 'settings') })
  const disposers = []
  const pending = new Set()
  const server = createServer((req, res) => {
    const handling = images(req, res, () => canvas(req, res, () => { res.statusCode = 404; res.end('{}') }))
    pending.add(handling)
    void handling.then(() => pending.delete(handling), error => res.destroy(error))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    const disposed = await Promise.allSettled(disposers.map(dispose => Promise.resolve().then(dispose)))
    const closed = new Promise(resolve => server.close(resolve))
    server.closeAllConnections()
    await closed
    // 断开 HTTP/SSE 连接并不会取消服务端已经进入的异步处理。
    // 先停订阅和接收请求，再等这些处理结束，最后删目录，避免迟到的读重建锁目录。
    const handled = await Promise.allSettled(pending)
    await rm(root, { recursive: true, force: true })
    const errors = [...disposed, ...handled].filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length) throw new AggregateError(errors, '隔离测试服务未能正常收尾。')
  })
  const base = `http://127.0.0.1:${server.address().port}`
  async function api(path, method = 'GET', body, headers = {}) {
    const res = await fetch(base + path, { method, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  return { api, root, base, workspace, beforeClose: dispose => disposers.push(dispose) }
}
