import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixture } from './perf/fixture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
export function createRendererFixture(count) {
  if (![500, 2000, 5000].includes(count)) throw new Error('预览只支持 500、2000、5000 个元素。')
  return createFixture(count)
}

export async function startRendererPreview({ port = 0 } = {}) {
  if (port !== 0 && (!Number.isInteger(port) || port < 43300 || port > 65535)) throw new Error('预览端口须在 43300–65535，测试可使用系统分配端口。')
  const fixtures = new Map()
  let server
  const http = createHttpServer((request, response) => server ? server.middlewares(request, response) : response.end())
  await new Promise((accept, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', accept) })
  try { server = await createServer({ root, configFile: false, publicDir: false, appType: 'mpa', optimizeDeps: { entries: ['tools/renderer-preview/index.html'], noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', '@tldraw/state', '@tldraw/state-react', '@tldraw/store', '@tldraw/tlschema', '@tldraw/utils'] }, server: { middlewareMode: true, hmr: { server: http, host: '127.0.0.1', clientPort: http.address().port } }, plugins: [{ name: 'readonly-renderer-preview', configureServer(vite) {
    vite.middlewares.use((request, response, next) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname === '/') request.url = `/tools/renderer-preview/index.html${url.search}`
      if (url.pathname !== '/__renderer_fixture') return next()
      if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
      const count = Number(url.searchParams.get('count'))
      if (![500, 2000, 5000].includes(count)) { response.writeHead(400); response.end('Invalid synthetic size'); return }
      if (!fixtures.has(count)) fixtures.set(count, JSON.stringify(createRendererFixture(count)))
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      response.end(fixtures.get(count))
    })
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
