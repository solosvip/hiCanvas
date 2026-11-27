import { BookmarkError, bookmarkTarget, bookmarkReference } from './bookmark-address.mjs'
import { createBookmarkConnection } from './bookmark-connection.mjs'
import { createBookmarkHead } from './bookmark-head.mjs'

const redirectStatuses = new Set([301,302,303,307,308])

function header(response,name) {
  const values = []
  for (let index=0; index<response.rawHeaders.length; index+=2) {
    if (response.rawHeaders[index].toLowerCase() === name) values.push(response.rawHeaders[index+1])
  }
  if (values.length > 1) throw new BookmarkError('upstream_failed',502)
  return values[0]
}

export function createBookmarkFetcher({ boundary, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const open = createBookmarkConnection(boundary)
  const active = new Set()
  let accepted = []
  let closed = false

  async function fetch(urlValue,{signal}={}) {
    let url = bookmarkTarget(urlValue)
    if (signal?.aborted) throw new BookmarkError('metadata_cancelled',499)
    if (closed || active.size >= 4) throw new BookmarkError('metadata_busy',503)
    const started = now()
    accepted = accepted.filter(time => time > started - 60000)
    if (accepted.length >= 20) throw new BookmarkError('rate_limited',429)
    accepted.push(started)
    const controller = new AbortController()
    const cancel = () => controller.abort(new BookmarkError('metadata_cancelled',499))
    signal?.addEventListener('abort',cancel,{once:true})
    active.add(controller)
    const timer = setTimer(() => controller.abort(new BookmarkError('metadata_timeout',504)),5000)
    let received = 0
    const check = () => {
      if (now() - started >= 5000 && !controller.signal.aborted) controller.abort(new BookmarkError('metadata_timeout',504))
      if (controller.signal.aborted) throw controller.signal.reason
    }
    const visited = new Set()
    try {
      for (let hop=0; ; hop++) {
        check()
        if (visited.has(url.href)) throw new BookmarkError('redirect_rejected')
        visited.add(url.href)
        const {response,close} = await open(url,controller.signal)
        try {
          check()
          const encoding = header(response,'content-encoding')
          if (encoding && encoding.trim().toLowerCase() !== 'identity') throw new BookmarkError('unsupported_encoding')
          const length = header(response,'content-length')
          if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 1024*1024-received)) throw new BookmarkError('upstream_too_large')
          if (redirectStatuses.has(response.statusCode)) {
            if (hop >= 3) throw new BookmarkError('redirect_limit')
            const location = header(response,'location')
            if (!location) throw new BookmarkError('redirect_rejected')
            let target
            try { target = bookmarkReference(location,url) } catch { throw new BookmarkError('redirect_rejected') }
            if (url.protocol === 'https:' && target.protocol !== 'https:') throw new BookmarkError('redirect_rejected')
            // Bodies on redirects are never consumed. Account for any bytes
            // already buffered by the HTTP parser, then destroy this socket.
            received += response.readableLength
            if (received > 1024*1024) throw new BookmarkError('upstream_too_large')
            url = target
            continue
          }
          if (response.statusCode !== 200) throw new BookmarkError('upstream_failed',502)
          const type = header(response,'content-type')
          if (!type || type.split(';')[0].trim().toLowerCase() !== 'text/html') throw new BookmarkError('unsupported_content_type')
          if (header(response,'content-disposition')) throw new BookmarkError('unsupported_content_type')
          const head = createBookmarkHead(type,url.href)
          for await (const chunk of response) {
            check()
            received += chunk.length
            if (received > 1024*1024) throw new BookmarkError('upstream_too_large')
            head.write(chunk)
            if (head.done) break
          }
          check()
          const result = head.finish()
          check()
          return result
        } finally { close() }
      }
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason
      throw error instanceof BookmarkError ? error : new BookmarkError('upstream_failed',502)
    } finally {
      clearTimer(timer)
      signal?.removeEventListener('abort',cancel)
      active.delete(controller)
    }
  }
  return { fetch, close() { closed=true; for (const controller of active) controller.abort(new BookmarkError('metadata_cancelled',499)) } }
}
