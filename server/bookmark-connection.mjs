import { Resolver } from 'node:dns/promises'
import { isIP, createConnection } from 'node:net'
import { connect as tlsConnect, checkServerIdentity } from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import { BookmarkError, selectBookmarkAddress } from './bookmark-address.mjs'

function aborted(signal) { return signal.reason instanceof BookmarkError ? signal.reason : new BookmarkError('metadata_cancelled',499) }

function withAbort(promise, signal, cancel) {
  return new Promise((resolve,reject) => {
    const stop = () => { cancel(); reject(aborted(signal)) }
    if (signal.aborted) return stop()
    signal.addEventListener('abort',stop,{once:true})
    promise.then(resolve,reject).finally(() => signal.removeEventListener('abort',stop))
  })
}

async function resolveTarget(url, signal, createResolver) {
  const host = url.hostname.replace(/^\[|\]$/g,'')
  if (isIP(host)) return selectBookmarkAddress([{address:host,family:isIP(host)}])
  const resolver = createResolver()
  const answers = await withAbort(Promise.allSettled([resolver.resolve4(host),resolver.resolve6(host)]), signal, () => resolver.cancel())
  const records = []
  for (const [index,result] of answers.entries()) {
    if (result.status === 'rejected') {
      if (!['ENODATA','ENOTFOUND'].includes(result.reason?.code)) throw new BookmarkError('upstream_failed',502)
    } else {
      if (!Array.isArray(result.value)) throw new BookmarkError('target_not_public')
      records.push(...result.value.map(address => ({address, family:index === 0 ? 4 : 6})))
    }
  }
  if (!records.length) throw new BookmarkError('upstream_failed',502)
  return selectBookmarkAddress(records)
}

function sameAddress(actual, selected) {
  if (isIP(actual) !== selected.family) return false
  if (selected.family === 4) return actual === selected.address
  return new URL(`http://[${actual}]/`).hostname === new URL(`http://[${selected.address}]/`).hostname
}

// OS seams are constructor-only, never request fields or production settings.
// This is the sole outgoing socket owner; all policy is always production code.
export function createBookmarkConnection({ createResolver = () => new Resolver(), connectTcp = createConnection, connectTls = tlsConnect } = {}) {
  return async function open(url, signal) {
    const selected = await resolveTarget(url,signal,createResolver)
    if (signal.aborted) throw aborted(signal)
    const secure = url.protocol === 'https:'
    const port = secure ? 443 : 80
    const hostname = url.hostname.replace(/^\[|\]$/g,'')
    const transport = secure ? https : http
    const agent = new transport.Agent({ keepAlive:false, maxSockets:1, proxyEnv:{} })
    let socket, request, response
    let rejectPending, failConnect
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      signal.removeEventListener('abort',stop)
      response?.destroy()
      request?.destroy()
      socket?.destroy()
      agent.destroy()
    }
    const stop = () => {
      const error = aborted(signal)
      failConnect?.(error)
      request?.destroy(error)
      rejectPending?.(error)
      close()
    }
    signal.addEventListener('abort',stop,{once:true})
    // Returning the socket here would let ClientRequest write HTTP before its
    // peer/certificate has been checked. Only the verified callback releases it.
    agent.createConnection = (_options, callback) => {
      let delivered = false
      const deliver = (error) => {
        if (delivered) return
        delivered = true
        if (error) { socket?.destroy(); callback(error); return }
        callback(null,socket)
      }
      failConnect = deliver
      try {
        socket = (secure ? connectTls : connectTcp)({ host:selected.address, family:selected.family, port,
          ...(secure ? { servername:isIP(hostname) ? undefined : hostname, rejectUnauthorized:true,
            checkServerIdentity:(_name,cert) => checkServerIdentity(hostname,cert), ALPNProtocols:['http/1.1'] } : {}) })
        socket.once('error',deliver)
        socket.once(secure ? 'secureConnect' : 'connect',() => {
          try {
            if (signal.aborted || closed || !sameAddress(socket.remoteAddress,selected) || socket.remotePort !== port ||
              (secure && (!socket.authorized || checkServerIdentity(hostname,socket.getPeerCertificate())))) {
              deliver(new BookmarkError('upstream_failed',502))
            } else deliver()
          } catch { deliver(new BookmarkError('upstream_failed',502)) }
        })
      } catch { deliver(new BookmarkError('upstream_failed',502)) }
      return undefined
    }
    try {
      return await new Promise((resolve,reject) => {
        rejectPending = reject
        request = transport.request(url,{ method:'GET', agent, maxHeaderSize:16*1024,
          headers:{ Host:url.host, Accept:'text/html', 'Accept-Encoding':'identity',
            'User-Agent':'Mozilla/5.0 (compatible; hiCanvas-bookmark)', Connection:'close' } }, incoming => {
          response = incoming
          // Until the caller installs its bounded consumer, don't flow a body.
          response.pause()
          resolve({response,close})
        })
        request.once('error',error => { close(); reject(signal.aborted ? aborted(signal) : error) })
        request.once('upgrade',(_response,upgraded) => { upgraded.destroy(); close(); reject(new BookmarkError('upstream_failed',502)) })
        if (signal.aborted) stop()
        else request.end()
      })
    } catch (error) { close(); throw error }
  }
}
