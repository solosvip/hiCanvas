import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { readJsonFile, writeJsonAtomic } from './storage.mjs'
import { httpError } from './file-lock.mjs'
import { applyCanvasOperations } from './canvas-operations.mjs'
import { createCanvasMedia } from './canvas-media.mjs'
import { pageFor } from './media-placement.mjs'
import { createImageResults } from './image-results.mjs'
import { requestImages, decodeReference } from './image-provider.mjs'
import { getCanvasEvents } from './events.mjs'

export function createImageJobs(workspace, models, { generate = requestImages, concurrency = 3 } = {}) {
  const directory = join(workspace.root, 'image-jobs')
  const media = createCanvasMedia(workspace)
  const events = getCanvasEvents(workspace)
  const jobs = new Map(), queue = []
  let active = 0
  let writing = Promise.resolve()
  const persist = job => {
    const pending = writing.then(() => writeJsonAtomic(join(directory, `${job.id}.json`), job))
    writing = pending.catch(() => {})
    return pending
  }
  async function alter(id, transform) {
    for (let i = 0; i < 8; i++) {
      const current = await workspace.read(id)
      try { const result = await workspace.mutate(id, current.revision, transform); events.broadcast(result); return result }
      catch (e) { if (e.storage !== 'revision-conflict') throw e }
    }
    throw httpError('画板持续被修改，生成结果已保留。', 409)
  }
  async function mark(job, item, status, error) {
    item.status = status
    if (error) item.error = error
    await persist(job)
    await alter(job.conversationId, snapshot => {
      const shape = snapshot.store[item.holderId]
      if (shape?.meta?.hicanvasGeneration?.itemId === item.id) shape.meta.hicanvasGeneration = { jobId: job.id, itemId: item.id, status, ...(error ? { error } : {}) }
      return snapshot
    }).catch(() => {})
  }
  async function execute(job, item) {
    try {
      await mark(job, item, 'running')
      const assetsDir = await workspace.assetsDir(job.conversationId)
      const references = []
      for (const src of item.references || []) {
        if (src.startsWith('data:')) { decodeReference(src); references.push(src) }
        else { const asset = await media.readAsset(job.conversationId, src); references.push(`data:${asset.mimeType};base64,${asset.bytes.toString('base64')}`) }
      }
      // 只调用一次供应商。文件和状态先落盘，再尝试写回目标框。
      const model = await models.get(job.modelId)
      await workspace.requireConversation(job.conversationId)
      const output = await generate(model, { prompt: item.prompt + (item.aspectRatio ? `\n输出画面比例：${item.aspectRatio}。每次只生成一张独立图片。` : ''), references, size: item.size, aspectRatio: item.aspectRatio })
      const results = createImageResults(assetsDir, `/c/${job.conversationId}/assets/`)
      item.images = await results.save(output)
      await persist(job)
      let inserted = true
      if (inserted) {
        for (const [index, image] of item.images.entries()) {
          for (let attempt = 0; attempt < 8; attempt++) {
            const current = await workspace.read(job.conversationId)
            const target = current.snapshot.store[index === 0 ? item.holderId : item.shapeId]
            if (!target || (index === 0 && target.meta?.hicanvasGeneration?.itemId !== item.id)) { inserted = false; break }
            try {
              const result = await media.insertImage(job.conversationId, { expectedRevision: current.revision, assetUrl: image.src, anchorShapeId: index === 0 ? item.holderId : item.shapeId, matchAnchor: index === 0, replaceAiImageHolder: true })
              item.shapeId = result.shapeId; events.broadcast(result); break
            } catch (e) { if (e.storage !== 'revision-conflict' || attempt === 7) throw e }
          }
        }
      }
      item.inserted = inserted
      await mark(job, item, inserted ? 'succeeded' : 'saved', inserted ? undefined : '原目标框已删除或替换；图片已保存在本画板的图片结果中。')
    } catch (error) {
      await mark(job, item, item.images?.length ? 'saved' : error.status === 410 ? 'cancelled' : 'failed', error.status ? error.message : '生成或写回失败；未自动重新调用生图，请先检查结果与服务商记录。')
    }
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const { job, item } = queue.shift()
      active++
      execute(job, item).finally(() => { active--; pump() }).catch(() => {})
    }
  }
  const ready = (async () => {
    let files
    try { files = await readdir(directory) } catch (e) { if (e.code !== 'ENOENT') throw e; return }
    for (const name of files.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const job = await readJsonFile(join(directory, name))
      jobs.set(job.id, job)
      for (const item of job.items) {
        if (item.status === 'running') await mark(job, item, item.images?.length ? 'saved' : 'interrupted', '服务曾中断，请先检查图片结果和服务商记录；未自动重试收费请求。')
        if (item.status === 'queued') queue.push({ job, item })
      }
    }
    pump()
  })()
  async function submit(id, args) {
    await ready
    if (!Array.isArray(args.requests) || !args.requests.length || args.requests.length > 64) throw httpError('每批需要 1 至 64 张独立图片。')
    const selectedModel = await models.get(args.modelId)
    for (const item of args.requests) {
      if (typeof item.prompt !== 'string' || !item.prompt.trim() || item.prompt.length > 32000) throw httpError('每张图片需要有效提示词。')
      if (item.aspectRatio && (!/^\d{1,4}:\d{1,4}$/.test(item.aspectRatio) || item.aspectRatio.split(':').some(n => Number(n) <= 0))) throw httpError('图片比例请填写宽:高。')
      if (item.references && (!Array.isArray(item.references) || item.references.length > 10)) throw httpError('每张最多 10 张参考图。')
      for (const src of item.references || []) if (typeof src !== 'string') throw httpError('参考图地址无效。'); else if (src.startsWith('data:')) decodeReference(src); else await media.readAsset(id, src)
    }
    const job = { id: randomUUID(), conversationId: id, modelId: selectedModel.id, createdAt: new Date().toISOString(), items: args.requests.map(r => ({ ...r, id: randomUUID(), holderId: r.anchorShapeId || `shape:${randomUUID()}`, status: 'queued' })) }
    const columns = args.columns ?? Math.min(4, Math.ceil(Math.sqrt(job.items.length)))
    if (!Number.isInteger(columns) || columns < 1 || columns > 16) throw httpError('每行数量需要 1 至 16。')
    const reserved = await workspace.mutate(id, args.expectedRevision, snapshot => {
      const store = snapshot.store
      const anchor = args.anchorShapeId ? store[args.anchorShapeId] : null
      if (args.anchorShapeId && !anchor) throw httpError('原目标框已删除。', 409)
      const pageId = args.pageId || Object.values(store).find(r => r.typeName === 'page')?.id
      if (store[pageId]?.typeName !== 'page') throw httpError('目标画布不存在。')
      if (anchor && pageFor(store, anchor) !== pageId) throw httpError('目标框不属于指定画布。')
      const width = args.displayWidth ?? anchor?.props.w ?? 512
      const height = args.displayHeight ?? anchor?.props.h ?? 512
      const gap = args.gap ?? 40
      if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 8192) || !Number.isFinite(gap) || gap < 0) throw httpError('图片框尺寸或间距无效。')
      const rowHeight = Math.max(height, ...job.items.map(item => { const ratio = item.aspectRatio?.split(':').map(Number); return ratio ? width * ratio[1] / ratio[0] : height }))
      const startX = args.x ?? (anchor ? anchor.x + (anchor.meta?.cowartAiImageHolder ? 0 : anchor.props.w + gap) : Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === pageId).reduce((x, r) => Math.max(x, r.x + (r.props?.w || 0) + gap), 0))
      const startY = args.y ?? anchor?.y ?? 0
      for (const [i, item] of job.items.entries()) {
        if (i === 0 && anchor?.meta?.cowartAiImageHolder && !item.anchorShapeId) item.holderId = anchor.id
        const ratio = item.aspectRatio?.split(':').map(Number)
        const h = ratio ? width * ratio[1] / ratio[0] : height
        const status = { jobId: job.id, itemId: item.id, status: 'queued' }
        const existing = store[item.holderId]
        if (existing) {
          if (!existing.meta?.cowartAiImageHolder || existing.type !== 'frame') throw httpError('只能替换 AI 图片占位框；改图请在原图旁新建目标。')
          if (pageFor(store, existing) !== pageId) throw httpError('图片框不属于指定画布。')
          if (['queued', 'running'].includes(existing.meta.hicanvasGeneration?.status)) throw httpError('这个图片框正在生成，请等待当前任务完成。', 409)
          existing.meta.hicanvasGeneration = status
        } else applyCanvasOperations(snapshot, [{ type: 'create_shape', id: item.holderId, shapeType: 'frame', parentId: anchor?.parentId || pageId, x: startX + (i % columns) * (width + gap), y: startY + Math.floor(i / columns) * (rowHeight + gap), props: { w: width, h, name: 'AI 图片', color: 'blue' }, meta: { cowartAiImageHolder: true, hicanvasGeneration: status } }])
      }
      return snapshot
    })
    await persist(job)
    jobs.set(job.id, job)
    events.broadcast(reserved)
    // 先将全部占位和任务持久化；HTTP/MCP 返回后由画板服务继续执行。
    queue.push(...job.items.map(item => ({ job, item })))
    setImmediate(pump)
    return { jobId: job.id, conversationId: id, revision: reserved.revision, items: job.items.map(({ references: _refs, ...item }) => item) }
  }
  async function get(id, jobId) {
    await ready
    await workspace.requireConversation(id)
    const job = jobs.get(jobId)
    if (!job || job.conversationId !== id) throw httpError('找不到这个画板的生成任务。', 404)
    return { ...job, items: job.items.map(({ references: _refs, ...item }) => item), finished: job.items.every(item => !['queued', 'running'].includes(item.status)) }
  }
  return { submit, get }
}
