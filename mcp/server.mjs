import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createApiClient } from './http-client.mjs'
import { openBrowser } from './startup.mjs'
import { createHash } from 'node:crypto'
import { registerBridgeTools } from './bridge-tools.mjs'
import { rexReceiver } from '../server/rex-delivery.mjs'

const conversationId = z.string().min(1).describe('open_conversation 返回的画板 ID；后续持续使用它，不跟随浏览器切换。')
const revision = z.string().min(1).describe('get_canvas 或上次写入返回的 revision；冲突后先重读并合并，禁止强行覆盖。')
const jsonRecord = z.record(z.string(), z.unknown())
const operation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_shape'), id: z.string().optional(), shapeType: z.enum(['geo', 'text', 'arrow', 'image', 'embed', 'frame', 'group']), parentId: z.string().optional(), x: z.number().optional(), y: z.number().optional(), rotation: z.number().optional(), props: jsonRecord.optional(), meta: jsonRecord.optional(), text: z.string().optional() }),
  z.object({ type: z.literal('put'), record: jsonRecord }),
  z.object({ type: z.literal('update'), id: z.string(), changes: jsonRecord }),
  z.object({ type: z.literal('delete'), ids: z.array(z.string()).min(1) })
])
function success(data) {
  const images = (data.requests || []).flatMap(r => r.content || []).filter(c => c.type === 'image' && c.data && c.mimeType).map(({ data, mimeType }) => ({ type: 'image', data, mimeType }))
  const structured = data.requests ? { ...data, requests: data.requests.map(r => ({ ...r, content: r.content?.map(c => c.type === 'image' ? { type: c.type, mimeType: c.mimeType, _meta: c._meta } : c) })) } : data
  return { content: [{ type: 'text', text: JSON.stringify(structured) }, ...images], structuredContent: structured }
}

export function createHiCanvasMcp({ baseUrl = 'http://127.0.0.1:43218', bindingKey = process.env.HICANVAS_CONVERSATION_KEY, open = openBrowser, receiver = rexReceiver() } = {}) {
  const api = createApiClient(baseUrl)
  let boundId = null
  let opening = Promise.resolve()
  const server = new McpServer({ name: 'hiCanvas', version: '0.0.8' }, { instructions: 'hiCanvas 是本机无限画板，每个画板只有一张画布，无需选择或新建页面。先 open_conversation 一次，记录 conversationId；所有后续工具显式使用该 ID。无新建要求不要设置 createNew。同一外部聊天使用稳定 bindingKey，重连可恢复；同一聊天的子 Agent 共享 conversationId。读 get_canvas 后使用 revision 批量修改；冲突先重新读取再合并。模型由用户在画板设置，不能读取密钥。用户要求生图时单张或多张统一用 submit_image_batch 一次提交全部提示词，画板自主创建占位、后台生成和排版；无需逐张发送或持续监控，失败不得自动重试。HTML、动效影片、Slides 使用 insert_cowart_html_draft 写回目标框。画板按钮请求用 get_canvas_requests 领取，处理后 complete_canvas_request。REX 内自动绑定原 Agent；其他宿主可用 MCP 请求队列接入。保留原版 HTML 预览编辑、影片 MP4 与 Slides 导出，不支持原生 PPTX；内置聊天暂未提供。' })
  function tool(name, description, inputSchema, handler, { readOnlyHint = false, openWorldHint = false, destructiveHint = false } = {}) {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, openWorldHint, destructiveHint } }, async args => {
      try { return success(await handler(args)) }
      catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: e.message, status: e.status, storage: e.storage, revision: e.revision }) }] } }
    })
  }
  const canvasPath = (id, suffix = '') => `/api/canvas${suffix}?conversation=${encodeURIComponent(id)}`
  async function openConversation(args) {
    const key = args.bindingKey || bindingKey
    const result = await api('/api/conversations/open', 'POST', { ...args, bindingKey: key, conversationId: args.conversationId || (!args.createNew && !key ? boundId || undefined : undefined) })
    const id = result.conversation.id
    boundId = id
    const canvas = await api(canvasPath(id))
    const agentConnection = receiver ? await api(`/api/agent/connect?conversation=${encodeURIComponent(id)}`, 'POST', { receiver }).catch(error => ({ connected: false, message: error.message })) : { mode: 'mcp' }
    const url = new URL(result.url, baseUrl).href
    if (args.openWindow) await open(url)
    return { ...result, conversationId: id, revision: canvas.revision, url, agentConnection }
  }
  tool('open_conversation', '创建或恢复画板。首次可直接调用，无需用户先创建。已有绑定时重复调用返回原画板；重连请传原 conversationId 或稳定 bindingKey。只有用户明确要求另起画板才 createNew:true。', { conversationId: conversationId.optional(), bindingKey: z.string().min(1).max(500).optional(), title: z.string().max(100).optional(), createNew: z.boolean().optional(), openWindow: z.boolean().optional() }, args => {
    const pending = opening.then(() => openConversation(args))
    opening = pending.catch(() => {})
    return pending
  })
  tool('list_conversations', '列出已保存的画板；不会创建画板或改变当前绑定。', {}, () => api('/api/conversations'), { readOnlyHint: true })
  tool('get_canvas', '读取指定画板的完整 tldraw 快照、版本、内容、选择项和视角。生成修改前先读，记录 ID 可用于精确修改。', { conversationId }, async ({ conversationId: id }) => {
    const [canvas, selection, view] = await Promise.all([api(canvasPath(id)), api(`/api/selection?conversation=${encodeURIComponent(id)}`), api(`/api/view-state?conversation=${encodeURIComponent(id)}`)])
    return { ...canvas, ...selection, ...view }
  }, { readOnlyHint: true })
  tool('apply_canvas_operations', '原子批量增改删画板。create_shape 可创建 geo/text/arrow/image/embed/frame/group，省略 parentId 自动放入画板，props 使用 tldraw 5.1.1 格式，text 自动转富文本；put 提供完整记录可操作其他形状和资源；update 合并属性；delete 级联删除子形状和连接。整批有效且版本相同才提交。', { conversationId, expectedRevision: revision, operations: z.array(operation).min(1).max(500) }, async ({ conversationId: id, ...body }) => {
    const result = await api(canvasPath(id, '/operations'), 'POST', body)
    return { ok: true, conversationId: id, revision: result.revision, recordIds: Object.keys(result.snapshot.store) }
  }, { destructiveHint: true })
  tool('list_image_models', '读取用户已配置的生图模型（不含密钥）。传返回的模型 ID 给 submit_image_batch；没有模型请让用户在设置里添加。', {}, () => api('/api/image-models'), { readOnlyHint: true })
  async function imageBytes(id, src) {
    if (!src.startsWith(`/c/${id}/assets/`) && !src.startsWith(`/c/${id}/page-assets/`)) throw new Error('只能读取当前画板的本机图片资源。')
    const assetUrl = new URL(src, baseUrl)
    if (!assetUrl.pathname.startsWith(`/c/${id}/assets/`) && !assetUrl.pathname.startsWith(`/c/${id}/page-assets/`)) throw new Error('资源路径越出了当前画板。')
    const response = await fetch(assetUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('图片资源无法读取。')
    if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) { await response.body?.cancel(); throw new Error('图片超过 20 MB。') }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 20 * 1024 * 1024) throw new Error('图片超过 20 MB。')
    return { bytes, mimeType: response.headers.get('content-type').split(';')[0] }
  }
  tool('generate_image', '单张生图的兼容入口：交给画板创建占位并在后台生成，立即返回 jobId。多张请一次调用 submit_image_batch；无需持续监控。仅用户要求时调用，失败禁止自动重试。', { conversationId, expectedRevision: revision, modelId: z.string().optional(), prompt: z.string().min(1).max(32000), x: z.number().optional(), y: z.number().optional(), displayWidth: z.number().positive().max(8192).optional(), referenceUrls: z.array(z.string()).max(10).optional() }, ({ conversationId: id, prompt, referenceUrls, ...args }) => api(`/api/images/jobs?conversation=${encodeURIComponent(id)}`, 'POST', { ...args, requests: [{ prompt, references: referenceUrls }] }), { openWorldHint: true })
  tool('list_image_results', '找回指定画板最近的已保存图片，包括生成成功但未插入的结果。', { conversationId }, ({ conversationId: id }) => api(`/api/images/results?conversation=${encodeURIComponent(id)}`), { readOnlyHint: true })
  server.registerTool('read_image', { description: '查看当前画板的本机图片。传画板资源 src；返回图片内容供视觉理解，可用于改图意见。', inputSchema: { conversationId, src: z.string() }, annotations: { readOnlyHint: true } }, async ({ conversationId: id, src }) => {
    try {
      await api(canvasPath(id))
      const { bytes, mimeType } = await imageBytes(id, src)
      return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType }] }
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] } }
  })
  tool('open_canvas', '打开指定画板；已安装桌面应用时在应用中打开，否则使用浏览器。窗口切换不会改变 Agent 操作的画板。', { conversationId }, async ({ conversationId: id }) => {
    await api(canvasPath(id))
    const url = new URL(`/?conversation=${encodeURIComponent(id)}`, baseUrl).href
    await open(url)
    return { conversationId: id, url }
  })
  registerBridgeTools({ tool, api, conversationId, revision, clientId: receiver ? createHash('sha256').update(`${receiver.sessionId}/${receiver.blockId}`).digest('hex') : bindingKey || undefined })
  return server
}
