import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { createConversations } from './conversations.mjs'
import { createCanvasMiddleware } from './routes.mjs'
import { createImageMiddleware } from './image-routes.mjs'
import { requireLocalRead } from './local-request.mjs'

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' }

// 桌面版和 MCP 使用与 Vite 插件完全相同的接口，只替换静态文件宿主。
export function createHiCanvasService({ distDir, canvasDir, settingsDir }) {
  const workspace = createConversations(canvasDir)
  const images = createImageMiddleware({ workspace, settingsDir })
  const canvas = createCanvasMiddleware({ workspace, settingsDir })
  const root = resolve(distDir)
  async function staticFile(req, res) {
    try {
      requireLocalRead(req)
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      if (pathname.startsWith('/api/') || pathname.includes('\0')) { res.writeHead(404); res.end(); return }
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { res.writeHead(404); res.end(); return }
      const bytes = await readFile(path)
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch (error) {
      res.writeHead(error.status || (error.code === 'ENOENT' ? 404 : 400)); res.end()
    }
  }
  return createServer((req, res) => {
    Promise.resolve(images(req, res, () => canvas(req, res, () => staticFile(req, res)))).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
}
