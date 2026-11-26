import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createFixture } from './perf/fixture.mjs'
import { appendFile, mkdir } from 'node:fs/promises'
import { requireLocalRequest, jsonBody } from '../server/local-request.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
export function createRendererFixture(count, { dash = 'solid' } = {}) {
  if (![500, 2000, 5000].includes(count)) throw new Error('预览只支持 500、2000、5000 个元素。')
  return createFixture(count, undefined, undefined, { dash })
}

// watch: false is for automated runs. A merge pipeline rebases files seconds
// before the run, and macOS can report those writes late; a watching server
// then reloads the page under test mid-assertion (#123 smoke). Only the file
// watcher goes: the page's HMR client still connects on this port, so it never
// retries a closed socket and logs errors the smoke counts (#118 found that).
export async function startRendererPreview({ port = 0, geometryFixtures = false, watch = true } = {}) {
  if (port !== 0 && (!Number.isInteger(port) || port < 43300 || port > 65535)) throw new Error('预览端口须在 43300–65535，测试可使用系统分配端口。')
  const fixtures = new Map()
  let server
  const http = createHttpServer((request, response) => server ? server.middlewares(request, response) : response.end())
  await new Promise((accept, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', accept) })
  try { server = await createServer({ root, configFile: false, publicDir: false, appType: 'mpa', optimizeDeps: { entries: ['tools/renderer-preview/index.html'], noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', '@tldraw/state', '@tldraw/state-react', '@tldraw/store', '@tldraw/tlschema', '@tldraw/utils', 'fontkit/core', 'fontkit/formats/WOFF2Font', 'fontkit/shapers/DefaultShaper', 'linebreak', 'unicode-segmenter/grapheme', 'unicode-segmenter/emoji'] }, server: { middlewareMode: true, hmr: { server: http, host: '127.0.0.1', clientPort: http.address().port }, ...(!watch && { watch: null }) }, plugins: [{ name: 'readonly-renderer-preview', configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname === '/__renderer_font_warning') {
        try {
          requireLocalRequest(request)
          if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
          const data = await jsonBody(request)
          if (data.kind !== 'text-layout-calibration' || !Array.isArray(data.warnings) || data.warnings.length > 96
            || data.warnings.some(w => !['sans', 'serif', 'mono', 'draw'].includes(w.font) || ![400, 700].includes(w.weight) || !['normal', 'italic'].includes(w.style) || !['天', 'あ', 'ｱ', '한', '😀', '。'].includes(w.sample) || !Number.isFinite(w.actual) || !Number.isFinite(w.expected))) throw new Error('Invalid calibration data')
          await mkdir(resolve(root, '.scratch'), { recursive: true })
          await appendFile(resolve(root, '.scratch/renderer-font-calibration.log'), JSON.stringify({ at: new Date().toISOString(), ...data }) + '\n')
          response.writeHead(204); response.end()
        } catch { response.writeHead(400); response.end() }
        return
      }
      if (url.pathname === '/api/health' && request.method === 'GET') { response.setHeader('content-type','application/json'); response.end(JSON.stringify({contentHost:{enabled:false}})); return }
      if (url.pathname === '/') request.url = `/tools/renderer-preview/index.html${url.search}`
      if (url.pathname !== '/__renderer_fixture') return next()
      if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
      const count = Number(url.searchParams.get('count'))
      if (![500, 2000, 5000].includes(count)) { response.writeHead(400); response.end('Invalid synthetic size'); return }
      const dash = url.searchParams.get('dash') || 'solid', key = `${count}:${dash}`
      if (!['solid', 'draw'].includes(dash)) { response.writeHead(400); response.end('Invalid synthetic dash'); return }
      if (!fixtures.has(key)) fixtures.set(key, JSON.stringify(createRendererFixture(count, { dash })))
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      response.end(fixtures.get(key))
    })
  }, async load(id) {
    // Test-only geometry registration: prove that a geometry provider alone
    // never opts a new type into drawing. Production modules remain untouched.
    if (!geometryFixtures || id !== resolve(root, 'renderer/bounds.js')) return
    const source = await readFile(id, 'utf8'), anchor = 'const geometryByType = Object.freeze({'
    if (!source.includes(anchor)) throw new Error('合成几何注册入口已变化，请更新绘制分派守卫。')
    return source.replace(anchor, anchor + '\n  synthetic_geometry_only: { hit: legacyHit, bounds: stored, contour: shape => box(stored(shape)) },')
  } }] }) } catch (error) { http.close(); throw error }
  return { url: `http://127.0.0.1:${http.address().port}`, async close() {
    await server.close()
    http.closeAllConnections()
    await new Promise((accept, reject) => http.close(error => error ? reject(error) : accept()))
  } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('用法：npm run renderer:preview -- --port 43330')
  const server = await startRendererPreview({ port: args.length ? Number(args[1]) : 43330 })
  console.log(`只读合成预览：${server.url}/?count=500（也可用 2000、5000）`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
}
