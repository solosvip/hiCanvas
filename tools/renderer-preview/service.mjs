import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { scratchPath } from '../perf/config.mjs'
import { createFixture } from '../perf/fixture.mjs'
import { prepareFixture } from '../perf/prepare.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
// Separate development host: production service and user data are never used.
// A browser reload preserves records on disk. Undo transport belongs to #82.
export async function startInteractionPreview({ port = 0, dataDir = resolve(root, '.scratch/interaction-preview') } = {}) {
  if (port !== 0 && (!Number.isInteger(port) || port < 43300 || port > 65535)) throw new Error('隔离预览端口须在 43300–65535。')
  const base = await scratchPath(dataDir, root)
  const paths = { PROJECT_DIR: base, CANVAS_DIR: join(base, 'canvas'), SETTINGS_DIR: join(base, 'settings'), DESKTOP_CONFIG_DIR: join(base, 'desktop-config') }
  for (const [key, path] of Object.entries(paths)) {
    await scratchPath(path, root); await mkdir(path, { recursive: true })
    for (const prefix of ['HICANVAS', 'COWART']) process.env[`${prefix}_${key}`] = path
  }
  delete process.env.HICANVAS_URL
  const [{ createConversations }, { createCanvasMiddleware }, { getCanvasEvents }, { requireLocalRead, requireLocalRequest, jsonBody }, { sendJson }] = await Promise.all([
    import('../../server/conversations.mjs'), import('../../server/routes.mjs'), import('../../server/events.mjs'), import('../../server/local-request.mjs'), import('../../server/protocol.mjs'),
  ])
  const workspace = createConversations(paths.CANVAS_DIR), canvas = createCanvasMiddleware({ workspace, settingsDir: paths.SETTINGS_DIR }), events = getCanvasEvents(workspace)
  const boards = new Map(), queues = new Map()
  const serial = (id, task) => {
    const next = (queues.get(id) || Promise.resolve()).then(task)
    queues.set(id, next.catch(() => {})); return next
  }
  async function fixture(count) {
    if (![500, 2000, 5000].includes(count)) throw new Error('合成规模仅支持 500、2000、5000。')
    if (!boards.has(count)) boards.set(count, (async () => {
      const title = `交互合成 ${count}`, existing = (await workspace.list()).find(b => b.title === title)
      const board = existing || await workspace.open({ createNew: true, title })
      let current = await workspace.read(board.id)
      const data = createFixture(count, current.snapshot)
      if (!existing) current = await prepareFixture(workspace, board.id, current, data.snapshot)
      return { count, counts: data.counts, assetCount: data.assetCount, targetId: data.targetId, viewState: data.viewState, conversationId: board.id, persistent: true }
    })())
    return boards.get(count)
  }
  let vite
  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname
    try {
      requireLocalRead(req)
      if (path === '/__renderer_fixture') {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const count = Number(url.searchParams.get('count'))
        if (![500, 2000, 5000].includes(count)) { res.writeHead(400); res.end(); return }
        return sendJson(res, 200, await fixture(count))
      }
      if (path.startsWith('/__interaction/')) {
        requireLocalRequest(req)
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const id = url.searchParams.get('conversation'), body = await jsonBody(req), actor = req.headers['x-hicanvas-actor']
        if (typeof actor !== 'string' || !actor.trim()) throw new Error('需要预览操作者。')
        // This host may edit only boards it provisioned, never arbitrary paths.
        const known = (await Promise.all(boards.values())).some(board => board.conversationId === id)
        if (!known) { res.writeHead(404); res.end(); return }
        const result = await serial(id, async () => {
          if (path !== '/__interaction/commit') throw new Error('未知预览操作。')
          const reply = await workspace.submitCommands(id, body.expectedRevision, actor, () => body.commands)
          events.broadcast(reply); return reply
        })
        return sendJson(res, 200, result)
      }
      if (path.startsWith('/api/')) {
        if (!['/api/canvas', '/api/canvas-events', '/api/view-state'].includes(path) || path === '/api/canvas' && req.method !== 'GET') { res.writeHead(403); res.end(); return }
        return canvas(req, res, () => { res.writeHead(404); res.end() })
      }
      if (path === '/') req.url = `/tools/renderer-preview/index.html${url.search}`
      vite.middlewares(req, res)
    } catch (error) { sendJson(res, error.status || (error.code === 'conflict' ? 409 : 400), { error: error.message, code: error.code }) }
  }
  const http = createHttpServer((req, res) => { void handle(req, res) })
  await new Promise((yes, no) => { http.once('error', no); http.listen(port, '127.0.0.1', yes) })
  try {
    vite = await createViteServer({ root, configFile: false, publicDir: false, appType: 'mpa', optimizeDeps: { entries: ['tools/renderer-preview/index.html'], noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', '@tldraw/state', '@tldraw/state-react', '@tldraw/store', '@tldraw/tlschema', '@tldraw/utils'] }, server: { middlewareMode: true, hmr: { server: http, host: '127.0.0.1', clientPort: http.address().port } } })
  } catch (error) { http.closeAllConnections(); http.close(); throw error }
  return { url: `http://127.0.0.1:${http.address().port}`, async close() {
    await vite.close(); http.closeAllConnections(); await new Promise((yes, no) => http.close(error => error ? no(error) : yes()))
  } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('用法：node tools/renderer-preview/service.mjs --port 43368')
  const preview = await startInteractionPreview({ port: args.length ? Number(args[1]) : 43368 })
  console.log(`隔离交互预览：${preview.url}/?count=500（可用 2000、5000；只用 .scratch 合成资料）`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0) })
}
