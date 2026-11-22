import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const guide = `你在处理用户从 hiCanvas 画板提交的请求。无需 Codex widget、插件或其专用技能。复用请求的 conversationId；每次写入前 get_canvas 取得最新 revision。HTML、影片、Slides 用 insert_cowart_html_draft；图片用画板已配置的模型与 submit_image_batch，或者将已有图片交给 insert_cowart_image。目标 ID、比例、参考图及标注按原请求执行。保留原稿，标注修改生成新稿。原提示中的 Codex 专用插件链接与技能路径仅是来源说明，不要求安装。完成后 complete_canvas_request；失败如实说明，不自动重试收费请求。
影片以完整单文件 HTML/CSS/JS 实现，接口 window.CowartFilm={duration,seek(seconds),play(),pause(),setMuted(bool),renderAudio({sampleRate,numberOfChannels})}。seek 必须确定性定位所有动画与声画状态，异步初始化提供 ready Promise；renderAudio 返回完整时长 AudioBuffer，含背景音乐与音效。文字使用可编辑 DOM。画板提供播放控件，HTML 不重复绘制控件。所有资源内联或引用本对话 /c/<conversationId>/assets/ 资源。` 

export function registerBridgeTools({ tool, api, conversationId, revision, clientId = randomUUID() }) {
  const path = (id, suffix) => `/api/${suffix}?conversation=${encodeURIComponent(id)}`
  const placement = { pageId: z.string().optional(), anchorShapeId: z.string().optional(), draftShapeId: z.string().optional(), displayWidth: z.number().positive().max(16384).optional(), displayHeight: z.number().positive().max(16384).optional(), matchAnchor: z.boolean().optional(), placement: z.enum(['right', 'left', 'below']).optional(), margin: z.number().nonnegative().optional(), shapeMeta: z.record(z.string(), z.unknown()).optional() }
  tool('submit_image_batch', '一次提交全部独立生图提示词。画板先创建所有占位框，返回 jobId 后自主并发生成、原位替换和按网格排好；无需 Agent 逐张生成或持续监控。失败不自动重试。单张也使用此工具。', { conversationId, expectedRevision: revision, pageId: z.string(), modelId: z.string().optional(), anchorShapeId: z.string().optional(), x: z.number().optional(), y: z.number().optional(), displayWidth: z.number().positive().max(8192).optional(), displayHeight: z.number().positive().max(8192).optional(), columns: z.number().int().min(1).max(16).optional(), requests: z.array(z.object({ prompt: z.string().min(1).max(32000), references: z.array(z.string()).max(10).optional(), aspectRatio: z.string().optional(), size: z.string().max(32).optional(), anchorShapeId: z.string().optional() })).min(1).max(64) }, ({ conversationId: id, ...args }) => api(path(id, 'images/jobs'), 'POST', args), { openWorldHint: true })
  tool('get_generation_job', '按需查看画板后台任务进度和已保存结果。任务无需此调用也会继续执行。', { conversationId, jobId: z.string() }, ({ conversationId: id, jobId }) => api(path(id, `images/jobs/${jobId}`)), { readOnlyHint: true })
  tool('insert_cowart_html_draft', '将完整 HTML、动效影片或 Slides 页面写回原版目标框。保留位置、尺寸、旋转、父容器；Slides 自动排列。每次先读取最新版本。', { conversationId, expectedRevision: revision, ...placement, htmlContent: z.string().optional(), htmlPath: z.string().optional(), fileName: z.string().optional(), updateExistingDraft: z.boolean().optional(), replaceDraftHolder: z.boolean().optional(), dryRun: z.boolean().optional() }, async ({ conversationId: id, htmlPath, ...args }) => api(path(id, 'canvas/html'), 'POST', { ...args, htmlContent: args.htmlContent ?? await readFile(htmlPath, 'utf8') }))
  tool('insert_cowart_image', '插入已有图片或原位替换 AI 图片框；保留原版的尺寸、旋转和旁置避让。assetUrl 必须属于当前对话；也可提供本机 imagePath 或 dataUrl。', { conversationId, expectedRevision: revision, ...placement, assetUrl: z.string().optional(), imagePath: z.string().optional(), dataUrl: z.string().optional(), replaceAiImageHolder: z.boolean().optional() }, async ({ conversationId: id, imagePath, ...args }) => {
    if (imagePath) {
      const bytes = await readFile(imagePath)
      const ext = imagePath.split('.').at(-1).toLowerCase()
      args.dataUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}`
    }
    return api(path(id, 'canvas/image'), 'POST', args)
  })
  tool('get_canvas_requests', '领取用户在画板中点击发送或按标注修改的请求，包括原提示、目标框和参考图。只处理指定对话；返回的 guide 说明通用 MCP 写回方式。', { conversationId, requestId: z.string().optional() }, async ({ conversationId: id, requestId }) => ({ ...await api(path(id, 'agent/requests/claim'), 'POST', { requestId, claimBy: clientId }), guide }))
  tool('complete_canvas_request', '完成或报告画板请求失败；应先将生成内容写回画板。', { conversationId, requestId: z.string(), status: z.enum(['completed', 'failed']), message: z.string().max(2000).optional() }, ({ conversationId: id, requestId, ...args }) => api(path(id, `agent/requests/${requestId}`), 'PUT', { ...args, claimBy: clientId }))
  tool('read_cowart_page_asset', '读取当前对话的参考图或 HTML 资源，不可跨对话读取。', { conversationId, assetUrl: z.string() }, ({ conversationId: id, ...args }) => api(path(id, 'canvas/asset/read'), 'POST', args), { readOnlyHint: true })
}
