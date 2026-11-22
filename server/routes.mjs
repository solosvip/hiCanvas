import { createHash } from 'node:crypto'
import { sendJson, isSelectionState, isViewState } from './protocol.mjs'
import { createConversations, conversations } from './conversations.mjs'
import { createCanvasEvents } from './events.mjs'
import { httpError } from './file-lock.mjs'
import { requireLocalRequest, requireLocalRead, jsonBody } from './local-request.mjs'
import { applyCanvasOperations } from './canvas-operations.mjs'

export function createCanvasMiddleware({ root, workspace = root ? createConversations(root) : conversations } = {}) {
  const events = createCanvasEvents()
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    if (!path.startsWith('/api/') && !/^\/c\//.test(path) && !/^\/(?:page-assets|assets)\//.test(path)) return next()
    if (path.startsWith('/api/image')) return next()
    try {
      requireLocalRead(req)
      if (path === '/api/health' && req.method === 'GET') return sendJson(res, 200, { name: 'hiCanvas', protocol: 1, workspace: createHash('sha256').update(workspace.root).digest('hex') })
      const scopedAsset = path.match(/^\/c\/([^/]+)\/(assets|page-assets)\//)
      if (scopedAsset || /^\/(?:page-assets|assets)\//.test(path)) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError('方法不支持。', 405)
        const id = scopedAsset ? scopedAsset[1] : 'legacy'
        const storage = await workspace.storageFor(id)
        const original = req.url
        req.url = scopedAsset ? req.url.slice(`/c/${id}`.length) : req.url
        try { return await storage.serveCanvasAsset(req, res, next) } finally { req.url = original }
      }
      // EventSource 不允许自定义请求头；仍须检查本机 Host / Origin。
      if (path === '/api/canvas-events' && req.method === 'GET') {
        const id = url.searchParams.get('conversation')
        await workspace.requireConversation(id)
        return events.subscribe(id, req, res)
      }
      requireLocalRequest(req)
      if (path === '/api/conversations' && req.method === 'GET') return sendJson(res, 200, { conversations: await workspace.list() })
      if (path === '/api/conversations/open' && req.method === 'POST') {
        const conversation = await workspace.open(await jsonBody(req))
        await workspace.read(conversation.id)
        return sendJson(res, 200, { conversation, url: `/?conversation=${conversation.id}` })
      }
      const rename = path.match(/^\/api\/conversations\/([^/]+)$/)
      if (rename && req.method === 'PUT') return sendJson(res, 200, { conversation: await workspace.rename(rename[1], (await jsonBody(req)).title) })
      const id = url.searchParams.get('conversation')
      await workspace.requireConversation(id)
      if (path === '/api/canvas' && req.method === 'GET') return sendJson(res, 200, await workspace.read(id))
      if ((path === '/api/canvas' && req.method === 'PUT') || (path === '/api/canvas/operations' && req.method === 'POST')) {
        const body = await jsonBody(req)
        const result = await workspace.mutate(id, body.expectedRevision, snapshot => path === '/api/canvas' ? body.snapshot : applyCanvasOperations(snapshot, body.operations))
        events.broadcast(result)
        return sendJson(res, 200, result)
      }
      if (path === '/api/html-draft' && req.method === 'PUT') {
        const body = await jsonBody(req)
        const result = await workspace.mutate(id, body.expectedRevision, snapshot => {
          const shape = snapshot.store[body.draftShapeId]
          if (shape?.type !== 'embed' || !shape.meta?.cowartHtmlDraft || typeof body.htmlContent !== 'string' || !body.htmlContent.trim()) throw httpError('网页草稿或内容无效。')
          snapshot.store[shape.id] = { ...shape, props: { ...shape.props, url: `data:text/html;base64,${Buffer.from(body.htmlContent).toString('base64')}` } }
          return snapshot
        })
        events.broadcast(result)
        return sendJson(res, 200, { ...result, shapeRecord: result.snapshot.store[body.draftShapeId], shapeId: body.draftShapeId })
      }
      for (const [route, type, valid, key] of [['/api/selection', 'selection', isSelectionState, 'selection'], ['/api/view-state', 'view', isViewState, 'viewState']]) {
        if (path !== route) continue
        if (req.method === 'GET') return sendJson(res, 200, { [key]: await workspace.sidecar(id, type) })
        if (req.method === 'PUT') {
          const body = await jsonBody(req)
          if (!valid(body)) throw httpError('选择状态或视角无效。')
          await workspace.sidecar(id, type, body)
          return sendJson(res, 200, { ok: true })
        }
      }
      throw httpError('接口或方法不存在。', 405)
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.status ? error.message : '本机资料无法完整读取或保存；已保留原文件，请检查资料目录。', storage: error.storage, revision: error.revision })
    }
  }
}

export function canvasStoragePlugin(options = {}) {
  const configure = server => { server.middlewares.use(createCanvasMiddleware(options)) }
  return { name: 'hicanvas-storage', configureServer: configure, configurePreviewServer: configure }
}
