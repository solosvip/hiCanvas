import { react } from '@tldraw/state'
import { bookmarkTarget, bookmarkPlan } from '../bookmarks.js'

const messages = {
  target_not_public: '此网址不在公开网络上，不能读取信息。', invalid_url: '网址无效。',
  redirect_rejected: '网页跳转不符合安全规则。', redirect_limit: '网页跳转次数过多。',
  upstream_too_large: '网页响应超过大小限制。', unsupported_content_type: '该响应不是可读取的 HTML 网页。',
  unsupported_encoding: '网页使用了不支持的压缩编码。', invalid_html: '网页头部无法安全解析。',
  rate_limited: '刷新次数过多，请稍后重试。', metadata_busy: '正在读取其他网页，请稍后重试。',
  metadata_timeout: '读取网页信息超时。', conflict: '画板已变化，本次信息未保存，请重新操作。',
}
export const bookmarkFailure = error => ({ code: Object.hasOwn(messages, error?.code) ? error.code : 'upstream_failed',
  message: messages[error?.code] || '暂时无法读取网页信息。' })

// The preparation queue is bounded and session-local. A ready result waits for
// user gestures, then submits exactly once at the latest confirmed revision.
export function createBookmarkJobs({ session, pageId, read, change, port, onEvent }) {
  const jobs = new Map()
  let disposed = false, scheduled = false
  const notice = message => change({ lastNotice: Object.freeze({ source: 'bookmark', message }) })
  const notify = () => { if (!disposed) change({ bookmarkJobs: Object.freeze([...jobs.values()].map(job => Object.freeze({ id: job.id, phase: job.phase, kind: job.kind }))) }) }
  function current(job) { return !disposed && jobs.get(job.id) === job }
  function valid(job) {
    try {
      const target = bookmarkTarget(session.store, job.id, pageId)
      return JSON.stringify(target.records) === job.basis
    } catch { return false }
  }
  function finish(job, status, data = {}) {
    if (!current(job)) return
    jobs.delete(job.id)
    job.resolve({ status, ...data })
    onEvent?.(job, status, data); notify()
  }
  function cancel(id) {
    const job = jobs.get(id)
    if (!job || job.phase === 'submitting') return false
    job.controller.abort(); finish(job, 'cancelled'); return true
  }
  function pulse() {
    if (disposed || scheduled || ![...jobs.values()].some(job => job.phase === 'ready')) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; void pump() })
  }
  async function pump() {
    const runtime = session.state.get(), state = read()
    if (disposed || runtime.isSubmitting || runtime.isGestureActive || state.mode !== 'idle' || state.temporaryTool || state.clipboardBusy || state.textEditing || state.imageAltEditing || state.croppingId) return
    const job = [...jobs.values()].find(item => item.phase === 'ready')
    if (!job) return
    if (!valid(job)) { cancel(job.id); return }
    try {
      if (!bookmarkPlan(session.store, job.command)) {
        finish(job, 'unchanged'); if (job.kind !== 'auto') notice('页面未提供新信息，书签保持原样。'); return
      }
      job.phase = 'submitting'; onEvent?.(job, 'submitting'); notify()
      const reply = await session.commitCommands([job.command], { expectedRevision: session.state.get().revision })
      finish(job, 'applied', { reply })
    } catch (error) {
      if (current(job)) {
        const failure = bookmarkFailure(error), committing = job.phase === 'submitting'
        // A lost acknowledgement can follow an accepted write. The runtime
        // refreshes the host's fact; never present this as a failed fetch.
        finish(job, 'failed', { ...failure, stage: committing ? 'commit' : 'prepare' })
        notice(committing ? '保存结果未能确认，请以当前画板为准并重新操作。' : failure.message)
      }
    } finally { pulse() }
  }
  function start({ id, url, metadata, kind = 'refresh' }) {
    if (disposed) return Promise.resolve({ status: 'unavailable' })
    const existing = jobs.get(id)
    if (existing?.phase === 'submitting') return Promise.resolve({ status: 'unavailable' })
    cancel(id)
    if (jobs.size >= 4) { notice('正在读取四个书签，请稍后手动刷新。'); return Promise.resolve({ status: 'unavailable' }) }
    const target = bookmarkTarget(session.store, id, pageId), controller = new AbortController()
    let resolve
    const promise = new Promise(yes => { resolve = yes })
    const job = { id, kind, controller, resolve, basis: JSON.stringify(target.records), phase: 'fetching' }
    const command = { type: kind === 'url' ? 'set_bookmark_url' : 'set_bookmark_metadata', id, assetId: target.asset.id, sourceUrl: target.shape.props.url, ...(kind === 'url' && { url }) }
    jobs.set(id, job); onEvent?.(job, 'fetching'); notify()
    void (async () => {
      try {
        const result = metadata === null && kind === 'url' ? null : await port.fetchMetadata(url || target.shape.props.url, { signal: controller.signal })
        if (!current(job)) return
        if (!valid(job)) { cancel(id); return }
        job.command = { ...command, metadata: result }; job.phase = 'ready'
        onEvent?.(job, 'ready'); notify(); pulse()
      } catch (error) {
        if (!current(job)) return
        const failure = bookmarkFailure(error); finish(job, 'failed', failure); notice(failure.message)
      }
    })()
    return promise
  }
  const stop = react('bookmark preparation runtime', () => { session.state.get(); pulse() })
  return {
    start, cancel, pulse,
    applyChanges() { for (const job of [...jobs.values()]) if (job.phase !== 'submitting' && !valid(job)) cancel(job.id) },
    dispose() {
      if (disposed) return
      stop()
      for (const job of [...jobs.values()]) {
        job.controller.abort(); jobs.delete(job.id); job.resolve({ status: 'cancelled' })
      }
      disposed = true
    },
  }
}
