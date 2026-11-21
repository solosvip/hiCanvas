import { join } from 'node:path'
import { homedir } from 'node:os'
import { createModelStore, inputError } from './image-models.mjs'
import { requestImages } from './image-provider.mjs'
import { createImageResults } from './image-results.mjs'
import { readRequestBody, sendJson } from './protocol.mjs'

export function createImageMiddleware({ settingsDir, assetsDir } = {}) {
  const projectDir = process.env.HICANVAS_PROJECT_DIR || join(homedir(), 'Documents', 'hiCanvas')
  const models = createModelStore(settingsDir || process.env.HICANVAS_SETTINGS_DIR || join(projectDir, 'settings'))
  const results = createImageResults(assetsDir || join(process.env.HICANVAS_CANVAS_DIR || join(projectDir, 'canvas'), 'assets'))
  return async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (!pathname.startsWith('/api/image-models') && !pathname.startsWith('/api/images')) return next()
    res.setHeader('cache-control', 'no-store')
    try {
      const host = req.headers.host || ''
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) || req.headers['x-hicanvas-client'] !== '1' || (req.headers.origin && req.headers.origin !== `http://${host}`)) throw inputError('只接受 hiCanvas 本机界面的请求。', 403)
      let body
      if (['POST', 'PUT'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw inputError('需要 JSON 请求。', 415)
        try { body = JSON.parse(await readRequestBody(req)) } catch { throw inputError('请求内容不是有效 JSON。') }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw inputError('请求内容必须是对象。')
      }
      if (pathname === '/api/images/results' && req.method === 'GET') return sendJson(res, 200, { images: await results.list() })
      if (pathname === '/api/images' && req.method === 'POST') {
        const images = await requestImages(await models.get(body.modelId), body)
        return sendJson(res, 200, { images: await results.save(images) })
      }
      if (pathname === '/api/image-models') {
        if (req.method === 'GET') return sendJson(res, 200, await models.list())
        if (req.method === 'POST') return sendJson(res, 200, await models.save(body))
      }
      if (pathname === '/api/image-models/active' && req.method === 'PUT') return sendJson(res, 200, await models.activate(body.modelId))
      const match = pathname.match(/^\/api\/image-models\/([\w-]+)$/)
      if (match) {
        if (req.method === 'PUT') return sendJson(res, 200, await models.save(body, match[1]))
        if (req.method === 'DELETE') return sendJson(res, 200, await models.remove(match[1]))
      }
      throw inputError('接口或方法不存在。', 404)
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.status ? error.message : '本机操作失败，请检查资料目录是否可写。' })
    }
  }
}

export function imageToolsPlugin() {
  const configure = server => { server.middlewares.use(createImageMiddleware()) }
  return { name: 'hicanvas-images', configureServer: configure, configurePreviewServer: configure }
}
