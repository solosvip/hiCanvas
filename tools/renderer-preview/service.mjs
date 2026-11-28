import { createServer as createHttpServer } from 'node:http'
import { captureLibraryImports } from '../check-renderer-boundary.mjs'
import { createServer as createViteServer } from 'vite'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { scratchPath } from '../perf/config.mjs'
import { createVideoFixture } from './video-fixtures.js'
import { createImageImportFixture } from './image-fixtures.js'
import { createFixture } from '../perf/fixture.mjs'
import { prepareFixture } from '../perf/prepare.mjs'
import { createClipboardFixture } from './clipboard-fixture.js'
import { createSlidesFixture, slidesFixtureCases } from './slides-fixture.js'
import { createFlattenFixture, flattenFixtureCases } from './flatten-fixture.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
// Separate development host: production service and user data are never used.
// A browser reload preserves records on disk. Undo/redo reuse the #82 host routes and actor-owned history.
export async function startInteractionPreview({ port = 0, dataDir = resolve(root, '.scratch/interaction-preview'), watch = true } = {}) {
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
    if (![500, 2000, 5000, 'videos', 'image-import', ...slidesFixtureCases.map(name => `slides-${name}`), ...flattenFixtureCases.map(name => `flatten-${name}`)].includes(count)) throw new Error('合成规模无效。')
    if (!boards.has(count)) boards.set(count, (async () => {
      const title = `交互合成 ${count}`, existing = (await workspace.list()).find(b => b.title === title)
      const board = existing || await workspace.open({ createNew: true, title })
      let current = await workspace.read(board.id)
      const data = String(count).startsWith('flatten-') ? createFlattenFixture(current.snapshot, count.slice(8)) : String(count).startsWith('slides-') ? createSlidesFixture(current.snapshot, count.slice(7)) : count === 'videos' ? createVideoFixture(current.snapshot) : count === 'image-import' ? createImageImportFixture(current.snapshot) : createFixture(count, current.snapshot)
      if (!existing) current = await prepareFixture(workspace, board.id, current, data.snapshot)
      return { count: data.count || count, ...(data.flattenFixture && { flattenFixture: data.flattenFixture }), ...(data.videoFixture && { videoFixture: true }), ...(data.imageImportFixture && { imageImportFixture: true }), ...(data.slidesFixture && { slidesFixture: true, fixtureCase: data.fixtureCase }), counts: data.counts, assetCount: data.assetCount, targetId: data.targetId, viewState: data.viewState, conversationId: board.id, persistent: true }
    })())
    return boards.get(count)
  }
  async function clipboardFixture(name) {
    const key = `clipboard-${name}`
    if (!boards.has(key)) boards.set(key, (async () => {
      const title = `剪贴板合成 ${name}`, existing = (await workspace.list()).find(board => board.title === title)
      const board = existing || await workspace.open({ createNew: true, title })
      const current = await workspace.read(board.id), data = createClipboardFixture({ empty: name === 'target' })
      if (!existing && name !== 'target') await prepareFixture(workspace, board.id, current, data.snapshot)
      return { ...data, snapshot: undefined, conversationId: board.id, persistent: true }
    })())
    const data = await boards.get(key), current = await workspace.read(data.conversationId)
    const shapes = Object.values(current.snapshot.store).filter(record => record.typeName === 'shape')
    return { ...data, count: shapes.length, counts: Object.fromEntries([...new Set(shapes.map(record => record.type))].map(type => [type, shapes.filter(record => record.type === type).length])) }
  }
  let vite
  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname
    try {
      if (path === '/__export_resource') {
        // Fixed synthetic pixels only. The native harness redirects its one
        // declared remote image here before any external connection is made.
        if (req.method !== 'GET' || !/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return }
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path fill="rgb(32,239,96)" d="M0 0H20V20H0Z"/></svg>')
        return
      }
      if (path === '/__export_guard') {
        // This fixed, synthetic document is deliberately embeddable from the
        // other loopback hostname to prove the OOPIF pre-document guard.
        if (!/^(127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return }
        const probe = url.searchParams.get('probe')
        if (req.method !== 'GET' || probe && !['clipboard', 'print', 'dialog', 'network', 'download'].includes(probe)) { res.writeHead(400); res.end(); return }
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
        res.end('<!doctype html><meta charset="utf-8"><body>owned export guard' + (probe ? `<script>window.__HICANVAS_EXPORT_GUARD__.probe(${JSON.stringify(probe)})</script>` : ''))
        return
      }
      requireLocalRead(req)
      if (path === '/__clipboard_fixture') {
        const name = url.searchParams.get('board')
        if (req.method !== 'GET' || !['source', 'target'].includes(name)) { res.writeHead(400); res.end(); return }
        return sendJson(res, 200, await clipboardFixture(name))
      }
      if (path === '/__renderer_fixture') {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const gallery = url.searchParams.get('gallery'), count = gallery === 'flatten' ? `flatten-${url.searchParams.get('case') || 'static'}` : gallery === 'slides' ? `slides-${url.searchParams.get('case') || 'base'}` : ['videos', 'image-import'].includes(gallery) ? gallery : Number(url.searchParams.get('count'))
        if (![500, 2000, 5000, 'videos', 'image-import', ...slidesFixtureCases.map(name => `slides-${name}`), ...flattenFixtureCases.map(name => `flatten-${name}`)].includes(count)) { res.writeHead(400); res.end(); return }
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
          const reply = await workspace.submitCommands(id, body.expectedRevision, actor, () => body.commands, { recordBasis: body.recordBasis })
          events.broadcast(reply); return reply
        })
        return sendJson(res, 200, result)
      }
      if (path.startsWith('/c/')) return canvas(req, res, () => { res.writeHead(404); res.end() })
      if (path.startsWith('/api/')) {
        const mutations = ['/api/canvas/undo', '/api/canvas/redo', '/api/canvas/reference', '/api/canvas/clipboard/copy', '/api/canvas/clipboard/paste']
        if (mutations.includes(path) && !(await Promise.all(boards.values())).some(board => board.conversationId === url.searchParams.get('conversation'))) { res.writeHead(404); res.end(); return }
        const exportRoutes = ['/api/health', '/api/content-host/instances']
        if (![...mutations, ...exportRoutes, '/api/canvas', '/api/canvas-events', '/api/view-state'].includes(path) || ['/api/canvas', '/api/health'].includes(path) && req.method !== 'GET') { res.writeHead(403); res.end(); return }
        return canvas(req, res, () => { res.writeHead(404); res.end() })
      }
      if (path === '/') req.url = `/tools/renderer-preview/index.html${url.search}`
      vite.middlewares(req, res)
    } catch (error) { sendJson(res, error.status || (error.code === 'conflict' ? 409 : 400), { error: error.message, code: error.code }) }
  }
  const http = createHttpServer((req, res) => { void handle(req, res) })
  await new Promise((yes, no) => { http.once('error', no); http.listen(port, '127.0.0.1', yes) })
  try {
    // Keep the Vite connection on this HTTP port; disabling its watcher stops
    // updates without making the browser retry a missing WebSocket server.
    vite = await createViteServer({ root, configFile: false, publicDir: false, appType: 'mpa', optimizeDeps: { entries: ['tools/renderer-preview/index.html'], noDiscovery: true, include: [...captureLibraryImports, 'react', 'react-dom', 'react-dom/client', 'react-dom/server.browser', '@tldraw/state', '@tldraw/state-react', '@tldraw/store', '@tldraw/tlschema', '@tldraw/utils', 'fontkit/core', 'fontkit/formats/WOFF2Font', 'fontkit/shapers/DefaultShaper', 'linebreak', 'unicode-segmenter/grapheme', 'unicode-segmenter/emoji'] }, server: { middlewareMode: true, ...(!watch && { watch: null }), hmr: { server: http, host: '127.0.0.1', clientPort: http.address().port } } })
  } catch (error) { http.closeAllConnections(); http.close(); throw error }
  // A read-only diagnostic snapshot lets checks distinguish no watchers from a
  // broken update connection. Do not expose the mutable Vite server or watcher.
  return { url: `http://127.0.0.1:${http.address().port}`, getWatchedPaths: () => Object.keys(vite.watcher.getWatched()), async close() {
    await vite.close(); await canvas.close(); http.closeAllConnections(); await new Promise((yes, no) => http.close(error => error ? no(error) : yes()))
  } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('用法：node tools/renderer-preview/service.mjs --port 43368')
  const preview = await startInteractionPreview({ port: args.length ? Number(args[1]) : 43368 })
  console.log(`隔离交互预览：${preview.url}/?count=500（可用 2000、5000；只用 .scratch 合成资料）`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0) })
}
