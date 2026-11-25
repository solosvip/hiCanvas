import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { workspaceIdentity } from './workspace-identity.mjs'
import { imageSettingsDirectory } from './image-settings-path.mjs'
import { sendJson, isSelectionState, isViewState } from './protocol.mjs'
import { createConversations, conversations } from './conversations.mjs'
import { getCanvasEvents } from './events.mjs'
import { httpError } from './file-lock.mjs'
import { requireLocalRequest, requireLocalRead, jsonBody } from './local-request.mjs'
import { CanvasEditError } from '../engine/index.js'
import { createCanvasMedia } from './canvas-media.mjs'
import { createAgentRequests } from './agent-requests.mjs'
import { saveExport } from './exports.mjs'

export function createCanvasMiddleware({ root, workspace = root ? createConversations(root) : conversations, agentOptions, settingsDir } = {}) {
  const events = getCanvasEvents(workspace)
  const media = createCanvasMedia(workspace)
  const requests = createAgentRequests(workspace, agentOptions)
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    const actor = req.headers['x-hicanvas-actor'] || 'http'
    if (!path.startsWith('/api/') && !/^\/c\//.test(path) && !/^\/(?:page-assets|assets)\//.test(path)) return next()
    if (path.startsWith('/api/image')) return next()
    try {
      requireLocalRead(req)
      if (path === '/api/health' && req.method === 'GET') return sendJson(res, 200, { name: 'hiCanvas', protocol: 2, canvasMode: 'single', workspace: createHash('sha256').update(workspace.root).digest('hex'), settingsWorkspace: workspaceIdentity(settingsDir || imageSettingsDirectory()) })
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
      if (rename && req.method === 'DELETE') {
        const result = await workspace.remove(rename[1], (await jsonBody(req)).expectedRevision)
        events.deleted(result)
        return sendJson(res, 200, result)
      }
      const id = url.searchParams.get('conversation')
      await workspace.requireConversation(id)
      if (path === '/api/exports/file' && req.method === 'POST') return sendJson(res, 200, await saveExport(join(workspace.root, 'conversations', id), await jsonBody(req)))
      if (path === '/api/agent/connect' && req.method === 'POST') return sendJson(res, 200, await requests.connect(id, (await jsonBody(req)).receiver))
      if (path === '/api/agent/requests' && req.method === 'POST') return sendJson(res, 202, { request: await requests.submit(id, await jsonBody(req)) })
      if (path === '/api/agent/requests' && req.method === 'GET') return sendJson(res, 200, { requests: (await requests.list(id, { includeFinished: true })).slice(-20).map(({ id, status, delivery, message }) => ({ id, status, delivery, message })) })
      if (path === '/api/agent/requests/claim' && req.method === 'POST') return sendJson(res, 200, { requests: await requests.list(id, await jsonBody(req)) })
      const completion = path.match(/^\/api\/agent\/requests\/([a-f0-9-]{36})$/)
      if (completion && req.method === 'PUT') return sendJson(res, 200, { request: await requests.complete(id, completion[1], await jsonBody(req)) })
      if (path === '/api/canvas/reference' && req.method === 'POST') return sendJson(res, 200, await media.reference(id, await jsonBody(req)))
      if (path === '/api/canvas/asset/read' && req.method === 'POST') {
        const result = await media.readAsset(id, (await jsonBody(req)).assetUrl)
        return sendJson(res, 200, { dataBase64: result.bytes.toString('base64'), mimeType: result.mimeType, assetPath: result.assetPath })
      }
      if (['/api/canvas/html', '/api/canvas/image'].includes(path) && req.method === 'POST') {
        const result = await (path.endsWith('/html') ? media.insertHtml : media.insertImage)(id, await jsonBody(req), actor)
        if (!result.dryRun) events.broadcast(result)
        return sendJson(res, 200, result)
      }
      if (path === '/api/canvas' && req.method === 'GET') return sendJson(res, 200, await workspace.read(id))
      if ((path === '/api/canvas' && req.method === 'PUT') || (path === '/api/canvas/operations' && req.method === 'POST')) {
        const body = await jsonBody(req)
        const { results: _results, ...result } = path === '/api/canvas'
          ? await workspace.replaceLegacySnapshot(id, body.expectedRevision, body.snapshot)
          : await workspace.submitCommands(id, body.expectedRevision, actor, () => body.operations)
        events.broadcast(result)
        return sendJson(res, 200, result)
      }
      if (path === '/api/html-draft' && req.method === 'PUT') {
        const body = await jsonBody(req)
        const result = await media.insertHtml(id, { ...body, updateExistingDraft: true }, actor)
        events.broadcast(result)
        return sendJson(res, 200, result)
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
      const status = error instanceof CanvasEditError ? (error.code === 'conflict' ? 409 : 400) : error.status
      sendJson(res, status || 500, { error: status ? error.message : '本机资料无法完整读取或保存；已保留原文件，请检查资料目录。', storage: error.storage, revision: error.revision })
    }
  }
}

export function canvasStoragePlugin(options = {}) {
  const configure = server => { server.middlewares.use(createCanvasMiddleware(options)) }
  return { name: 'hicanvas-storage', configureServer: configure, configurePreviewServer: configure }
}
