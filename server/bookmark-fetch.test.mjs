import '../tools/test-sandbox.mjs'
import test, { after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Duplex } from 'node:stream'
import { createBookmarkFetcher } from './bookmark-fetch.mjs'
import net from 'node:net'
import tls from 'node:tls'
import { Resolver } from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'

let unexpectedNetwork=0
const denyNetwork=()=>{unexpectedNetwork++;throw new Error('Real network forbidden in bookmark tests')}
mock.method(net,'createConnection',denyNetwork)
mock.method(tls,'connect',denyNetwork)
mock.method(Resolver.prototype,'resolve4',denyNetwork)
mock.method(Resolver.prototype,'resolve6',denyNetwork)
syncBuiltinESMExports()
after(()=>{assert.equal(unexpectedNetwork,0);mock.restoreAll();syncBuiltinESMExports()})

// Only the OS boundary is substituted. Requests still go through Node's real
// ClientRequest/Agent/HTTP parser and all production address/TLS/redirect rules.
function fixture(replies = [], options = {}) {
  const requests = [], sockets = [], dns = [], connects = []
  let cancelled = 0
  const boundary = {
    createResolver() {
      return {
        async resolve4(host) { dns.push([host,4]); if (options.dnsHang) return new Promise(() => {}); if(options.dnsError4)throw Object.assign(new Error('secret'),{code:options.dnsError4});return typeof options.answers4==='function'?options.answers4():options.answers4 ?? ['8.8.8.8'] },
        async resolve6(host) { dns.push([host,6]); if (options.dnsError6) throw Object.assign(new Error('secret'), {code:options.dnsError6}); return options.answers6 ?? [] },
        cancel() { cancelled++ },
      }
    },
    connectTcp: connect,
    connectTls: connect,
  }
  function connect(config) {
    connects.push(config)
    const reply = replies.shift()
    let raw = ''
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        raw += chunk.toString()
        if (raw.includes('\r\n\r\n') && !requests.some(item => item.socket === socket)) {
          requests.push({raw,socket})
          if (reply) queueMicrotask(() => {
            if (!socket.destroyed) {
              if (typeof reply === 'function') reply(socket)
              else { socket.push(reply); if (!options.hangBody) socket.push(null) }
            }
          })
        }
        callback()
      },
    })
    socket.remoteAddress = options.peer ?? config.host
    socket.remotePort = options.peerPort ?? config.port
    socket.authorized = !options.badAuthorization
    socket.getPeerCertificate = () => ({ subjectaltname:options.cert ?? `DNS:${options.certHost ?? 'site.example.net'}` })
    socket.setNoDelay = socket.setKeepAlive = socket.setTimeout = () => socket
    sockets.push(socket)
    queueMicrotask(() => { if (!socket.destroyed && !options.tlsHang) socket.emit(config.rejectUnauthorized ? 'secureConnect' : 'connect') })
    return socket
  }
  const fetcher = createBookmarkFetcher({ boundary, ...options.clock })
  return {fetcher, requests, sockets, dns, connects, get cancelled() {return cancelled}}
}
const response = (body='<head><title>Hello</title></head>', headers='') => `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n${headers}Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
const redirect = (location) => `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 0\r\n\r\n`

test('real HTTP parser receives only pinned IP and anonymous fixed request headers', async () => {
  const f = fixture([response()])
  try {
    assert.deepEqual(await f.fetcher.fetch('https://site.example.net/path?q=secret#fragment'), {title:'Hello',description:'',url:'https://site.example.net/path?q=secret'})
    assert.equal(f.dns.length,2)
    assert.equal(f.connects.length,1)
    assert.equal(f.connects[0].host,'8.8.8.8')
    assert.equal(f.connects[0].servername,'site.example.net')
    assert.equal(f.connects[0].rejectUnauthorized,true)
    assert.match(f.requests[0].raw,/^GET \/path\?q=secret HTTP\/1.1\r\n/)
    assert.match(f.requests[0].raw,/Host: site\.example\.net\r\n/i)
    assert.match(f.requests[0].raw,/Accept-Encoding: identity/i)
    assert.match(f.requests[0].raw,/User-Agent: Mozilla\/5\.0 \(compatible; hiCanvas-bookmark\)\r\n/i)
    assert.doesNotMatch(f.requests[0].raw,/Cookie:|Authorization:|Referer:|Origin:|x-hicanvas-/i)
    assert.ok(f.sockets.every(s=>s.destroyed))
  } finally { f.fetcher.close() }
})

test('bad peer, wrong certificate and TLS rejection fail before any HTTP byte', async () => {
  for (const options of [{peer:'127.0.0.1'},{peerPort:444},{certHost:'wrong.net'},{badAuthorization:true}]) {
    const f = fixture([response()],options)
    await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'upstream_failed'})
    assert.equal(f.requests.length,0)
    assert.ok(f.sockets.every(s=>s.destroyed))
    f.fetcher.close()
  }
})

test('mixed or uncertain DNS cannot reach any socket', async () => {
  for (const options of [{answers4:['8.8.8.8','10.0.0.1']},{answers6:['fc00::1']},{dnsError6:'ESERVFAIL'}]) {
    const f=fixture([],options)
    await assert.rejects(f.fetcher.fetch('https://site.example.net/'))
    assert.equal(f.connects.length,0)
    f.fetcher.close()
  }
})

test('nonexistent domains report upstream failure while private answers remain policy rejection',async()=>{
  for(const options of [{dnsError4:'ENOTFOUND',dnsError6:'ENOTFOUND'},{dnsError4:'ENODATA',dnsError6:'ENODATA'},{answers4:[],answers6:[]}]){
    const f=fixture([],options)
    await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'upstream_failed',status:502})
    assert.equal(f.connects.length,0)
    f.fetcher.close()
  }
})

test('normal EOF without a closing head succeeds; broken HTTP framing still fails',async()=>{
  const f=fixture([response('<title>clean EOF</title>')])
  assert.equal((await f.fetcher.fetch('https://site.example.net/')).title,'clean EOF')
  assert.ok(f.sockets.every(s=>s.destroyed))
  f.fetcher.close()
})

test('three redirects recheck DNS; fourth hop, loops, private and downgrade fail', async () => {
  const f=fixture([redirect('/a'),redirect('/b'),redirect('/c'),response()])
  assert.equal((await f.fetcher.fetch('https://site.example.net/')).url,'https://site.example.net/c')
  assert.equal(f.dns.length,8)
  assert.equal(f.connects.length,4)
  f.fetcher.close()
  for (const replies of [
    [redirect('/a'),redirect('/b'),redirect('/c'),redirect('/d')],
    [redirect('/')], [redirect('http://site.example.net/')], [redirect('https://127.0.0.1/')],
    [redirect('https://site.example.net:444/')], [redirect('file:///etc/passwd')],
    ['HTTP/1.1 302 Found\r\nLocation: /a\r\nLocation: /b\r\nContent-Length: 0\r\n\r\n'],
  ]) {
    const f=fixture(replies)
    await assert.rejects(f.fetcher.fetch('https://site.example.net/'))
    assert.ok(f.sockets.every(s=>s.destroyed))
    f.fetcher.close()
  }
})

test('compressed, non-HTML, oversize, malformed, truncated and upgrade responses fail closed', async () => {
  for (const raw of [response('', 'Content-Encoding: gzip\r\n'),
    'HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 0\r\n\r\n',
    'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1048577\r\n\r\n',
    'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 100\r\n\r\n<head><title>incomplete',
    'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX: '+ 'x'.repeat(17000)+'\r\n\r\n',
    'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n']) {
    const f=fixture([raw])
    await assert.rejects(f.fetcher.fetch('https://site.example.net/'))
    assert.ok(f.sockets.every(s=>s.destroyed))
    f.fetcher.close()
  }
})

function fakeClock() {
  let time=0, next=0
  const timers = new Map()
  return { options:{now:()=>time,setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id},clearTimer:id=>timers.delete(id)},
    advance(ms) {time+=ms;for (const [id,timer] of timers) if (timer.at<=time) {timers.delete(id);timer.fn()}},
    get size() {return timers.size} }
}
const turn = () => new Promise(resolve=>setImmediate(resolve))

test('cancellable DNS, TLS and endless body share the same absolute five-second deadline', async () => {
  for (const opts of [{dnsHang:true},{tlsHang:true},{hangBody:true}]) {
    const clock=fakeClock()
    const reply='HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n<head>\r\n'
    const f=fixture([reply],{...opts,clock:clock.options})
    const pending=assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'metadata_timeout'})
    await turn()
    clock.advance(4999)
    assert.equal(clock.size,1)
    clock.advance(1)
    await pending
    if(opts.dnsHang) assert.equal(f.cancelled,1)
    assert.ok(f.sockets.every(s=>s.destroyed))
    assert.equal(clock.size,0)
    f.fetcher.close()
  }
})

test('four active tasks reject a fifth without DNS; cancellation frees slots', async () => {
  const f=fixture([],{dnsHang:true})
  const controllers=Array.from({length:4},()=>new AbortController())
  const pending=controllers.map(controller=>assert.rejects(f.fetcher.fetch('https://site.example.net/',{signal:controller.signal}),{code:'metadata_cancelled'}))
  await turn()
  const before=f.dns.length
  await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'metadata_busy',status:503})
  assert.equal(f.dns.length,before)
  controllers.forEach(c=>c.abort())
  await Promise.all(pending)
  const next=new AbortController()
  const task=assert.rejects(f.fetcher.fetch('https://site.example.net/',{signal:next.signal}),{code:'metadata_cancelled'})
  next.abort();await task
  f.fetcher.close()
})

test('rolling rate counts accepted work, rejects before DNS and expires after 60s', async () => {
  const clock=fakeClock()
  const f=fixture(Array.from({length:21},()=>response()),{clock:clock.options})
  for (let n=0;n<20;n++) await f.fetcher.fetch('https://site.example.net/')
  const before=f.dns.length
  await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'rate_limited',status:429})
  assert.equal(f.dns.length,before)
  clock.advance(60000)
  assert.equal((await f.fetcher.fetch('https://site.example.net/')).title,'Hello')
  f.fetcher.close()
})

test('closing service aborts in-flight work and never admits more', async () => {
  const f=fixture([],{dnsHang:true})
  const pending=assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'metadata_cancelled'})
  await turn();f.fetcher.close();f.fetcher.close()
  await pending
  assert.equal(f.cancelled,1)
  await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'metadata_busy'})
})

test('redirect raw spellings cannot bypass strict URL checks', async () => {
  for (const location of ['https://0x08080808/','https://site.example.net\\@evil.net/','https://%73ite.example.net/']) {
    const f=fixture([redirect(location),response()])
    await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'redirect_rejected'})
    assert.equal(f.connects.length,1)
    f.fetcher.close()
  }
})

test('same-host redirect cannot reuse a previous public DNS decision',async()=>{
  let lookup=0
  const f=fixture([redirect('/next')],{answers4:()=>++lookup===1?['8.8.8.8']:['10.0.0.1']})
  await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'target_not_public'})
  assert.equal(f.connects.length,1)
  f.fetcher.close()
})

test('a missing DNS family is allowed; IP literals need no DNS or SNI',async()=>{
  const f=fixture([response()],{dnsError6:'ENODATA'})
  assert.equal((await f.fetcher.fetch('https://site.example.net/')).title,'Hello')
  f.fetcher.close()
  const ip=fixture([response()],{cert:'IP Address:8.8.8.8'})
  assert.equal((await ip.fetcher.fetch('https://8.8.8.8/')).title,'Hello')
  assert.equal(ip.dns.length,0)
  assert.equal(ip.connects[0].servername,undefined)
  assert.match(ip.requests[0].raw,/Host: 8\.8\.8\.8/i)
  ip.fetcher.close()
})

test('proxy environment never changes the chosen direct target',async()=>{
  const previous=process.env.HTTPS_PROXY
  process.env.HTTPS_PROXY='http://127.0.0.1:9'
  const f=fixture([response()])
  try{
    assert.equal((await f.fetcher.fetch('https://site.example.net/')).title,'Hello')
    assert.equal(f.connects[0].host,'8.8.8.8')
    assert.doesNotMatch(f.requests[0].raw,/Proxy-|127\.0\.0\.1/)
  }finally{f.fetcher.close();if(previous===undefined)delete process.env.HTTPS_PROXY;else process.env.HTTPS_PROXY=previous}
})

test('body bytes across redirects and chunked streams cannot exceed 1 MiB',async()=>{
  const huge=Buffer.alloc(1048577,32)
  const chunked=socket=>{
    socket.push('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n')
    socket.push(huge.length.toString(16)+'\r\n');socket.push(huge);socket.push('\r\n0\r\n\r\n');socket.push(null)
  }
  const f=fixture([chunked])
  await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'upstream_too_large'})
  assert.ok(f.sockets.every(s=>s.destroyed));f.fetcher.close()
  const body=' '.repeat(600000)
  const chain=fixture([`HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: ${body.length}\r\n\r\n${body}`,response('<head></head>','X: ok\r\n').replace('Content-Length: 13','Content-Length: 600000')])
  await assert.rejects(chain.fetcher.fetch('https://site.example.net/'),{code:'upstream_too_large'})
  chain.fetcher.close()
})

test('absolute deadline is shared across redirects, never reset by the next response',async()=>{
  const clock=fakeClock()
  const f=fixture([
    socket=>{clock.advance(3000);socket.push(redirect('/next'));socket.push(null)},
    socket=>{clock.advance(2001);if(!socket.destroyed){socket.push(response());socket.push(null)}},
  ],{clock:clock.options})
  await assert.rejects(f.fetcher.fetch('https://site.example.net/'),{code:'metadata_timeout'})
  assert.ok(f.sockets.every(s=>s.destroyed))
  assert.equal(clock.size,0)
  f.fetcher.close()
})

test('IPv6 DNS answers connect by family while preserving hostname identity',async()=>{
  const f=fixture([response()],{answers4:[],answers6:['2606:4700:4700::1111'],peer:'2606:4700:4700:0:0:0:0:1111'})
  assert.equal((await f.fetcher.fetch('https://site.example.net/')).title,'Hello')
  assert.equal(f.connects[0].family,6)
  assert.equal(f.connects[0].host,'2606:4700:4700::1111')
  assert.equal(f.connects[0].servername,'site.example.net')
  f.fetcher.close()
})
