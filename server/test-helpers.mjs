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
  const canvas = createCanvasMiddleware({ workspace })
  const images = createImageMiddleware({ workspace, settingsDir: join(root, 'settings') })
  const server = createServer((req, res) => images(req, res, () => canvas(req, res, () => { res.statusCode = 404; res.end('{}') })))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  async function api(path, method = 'GET', body, headers = {}) {
    const res = await fetch(base + path, { method, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  return { api, root, base, workspace }
}
