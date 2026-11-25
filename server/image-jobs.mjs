import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { readJsonFile, writeJsonAtomic } from './storage.mjs'
import { httpError } from './file-lock.mjs'
import { CanvasEditError } from '../engine/index.js'
import { createCanvasMedia } from './canvas-media.mjs'
import { createImageResults } from './image-results.mjs'
import { requestImages, decodeReference } from './image-provider.mjs'
import { getCanvasEvents } from './events.mjs'
import { singlePageId } from './single-canvas.mjs'

// Translate edit errors at the host boundary so the existing image HTTP/MCP
// contract keeps its status codes and messages without coupling engine to HTTP.
async function commitCommands(workspace, id, revision, createCommands) {
  try { return await workspace.submitCommands(id, revision, 'image-jobs', createCommands) }
  catch (error) {
    if (error instanceof CanvasEditError) throw httpError(error.message, error.code === 'conflict' ? 409 : 400)
    throw error
  }
}

export function createImageJobs(workspace, models, { generate = requestImages, concurrency = 3 } = {}) {
  const directory = join(workspace.root, 'image-jobs')
  const media = createCanvasMedia(workspace)
  const events = getCanvasEvents(workspace)
  const jobs = new Map(), queue = []
  const canvasWrites = new Map()
  const running = new Set()
  let active = 0
  let writing = Promise.resolve()
  const persist = job => {
    const pending = writing.then(() => writeJsonAtomic(join(directory, `${job.id}.json`), job))
    writing = pending.catch(() => {})
    return pending
  }
  function writeCanvas(id, operation) {
    // 只排队画板读改写；生图请求继续并发，避免同批任务耗尽彼此的版本重试。
    const pending = (canvasWrites.get(id) ?? Promise.resolve()).then(operation)
    const settled = pending.catch(() => {})
    canvasWrites.set(id, settled)
    settled.then(() => { if (canvasWrites.get(id) === settled) canvasWrites.delete(id) })
    return pending
  }
  async function alter(id, createCommands) {
    return writeCanvas(id, async () => {
      for (let i = 0; i < 8; i++) {
        const current = await workspace.read(id)
        try { const result = await commitCommands(workspace, id, current.revision, createCommands); events.broadcast(result); return result }
        catch (e) { if (e.storage !== 'revision-conflict') throw e }
      }
      throw httpError('画板持续被修改，生成结果已保留。', 409)
    })
  }
  async function mark(job, item, status, error) {
    item.status = status
    if (error) item.error = error
    await persist(job)
    await alter(job.conversationId, snapshot => {
      const shape = snapshot.store[item.holderId]
      if (shape?.meta?.hicanvasGeneration?.itemId === item.id) return [{ type: 'update', id: item.holderId, changes: { meta: { hicanvasGeneration: { jobId: job.id, itemId: item.id, status, ...(error ? { error } : {}) } } } }]
      // 目标已换掉时不改内容，仍完成原有的无变化事务，保留版本与收尾顺序。
      return [{ type: 'update', id: singlePageId(snapshot), changes: {} }]
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
      const inserted = await writeCanvas(job.conversationId, async () => {
        for (const [index, image] of item.images.entries()) {
          for (let attempt = 0; attempt < 8; attempt++) {
            const current = await workspace.read(job.conversationId)
            const target = current.snapshot.store[index === 0 ? item.holderId : item.shapeId]
            if (!target || (index === 0 && target.meta?.hicanvasGeneration?.itemId !== item.id)) return false
            try {
              const result = await media.insertImage(job.conversationId, { expectedRevision: current.revision, assetUrl: image.src, anchorShapeId: index === 0 ? item.holderId : item.shapeId, matchAnchor: index === 0, replaceAiImageHolder: true }, 'image-jobs')
              item.shapeId = result.shapeId; events.broadcast(result); break
            } catch (e) { if (e.storage !== 'revision-conflict' || attempt === 7) throw e }
          }
        }
        return true
      })
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
      const pending = execute(job, item).finally(() => { running.delete(pending); active--; pump() }).catch(() => {})
      running.add(pending)
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
    const reserved = await writeCanvas(id, () => commitCommands(workspace, id, args.expectedRevision, () => [{ type: 'reserve_image_batch', jobId: job.id, items: job.items, args }]))
    const holderIds = reserved.results[0].holderIds
    // Apply the receipt only after the complete reservation was saved. A failed
    // transaction cannot leak partially resolved holder IDs into persisted jobs.
    job.items.forEach((item, index) => { item.holderId = holderIds[index] })
    await persist(job)
    jobs.set(job.id, job)
    events.broadcast(reserved)
    // 先将全部占位和任务持久化；HTTP/MCP 返回后由画板服务继续执行。
    queue.push(...job.items.map(item => ({ job, item })))
    setImmediate(pump)
    return { jobId: job.id, conversationId: id, revision: reserved.revision, actor: reserved.actor, items: job.items.map(({ references: _refs, ...item }) => item) }
  }
  async function get(id, jobId) {
    await ready
    await workspace.requireConversation(id)
    const job = jobs.get(jobId)
    if (!job || job.conversationId !== id) throw httpError('找不到这个画板的生成任务。', 404)
    return { ...job, items: job.items.map(({ references: _refs, ...item }) => item), finished: job.items.every(item => !['queued', 'running'].includes(item.status)) }
  }
  async function waitForIdle() {
    await ready
    // 完成状态可能先于落盘可见；执行中的任务还会继续追加持久化和画板写入。
    // concurrency 为 0 时只等已经开始的工作，不启动刻意暂停的队列。
    while (true) {
      pump()
      const persisted = writing
      await Promise.all([persisted, ...canvasWrites.values(), ...running])
      if (!running.size && !canvasWrites.size && writing === persisted) return
    }
  }
  return { submit, get, waitForIdle }
}
