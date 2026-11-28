import { createHash } from 'node:crypto'
import net from 'node:net'

export const GIST_FIXTURE_IDS = Object.freeze(['0123456789abcdef0123456789abcdef', 'fedcba9876543210fedcba9876543210', 'abc012'])
const cssUrl = 'https://github.githubassets.com/assets/hicanvas-gist-fixture.css'
const adapters = new WeakMap()
const retired = new WeakSet()
// Runs as the locally fulfilled official script, not via debugger evaluation.
// Every attack is finite and targets only this run's synthetic parent/instances.
function fixtureScript(id, css, otherId, broken) {
  const probe = window.__gistFixture = { id, origin: location.origin, attempts: [], violations: [], executions: [], messages: [], inputs: [], css: false }
  for (const type of ['pointerdown', 'input', 'keydown', 'keyup']) addEventListener(type, event => probe.inputs.push({ type, target: event.target?.tagName, trusted: event.isTrusted, key: event.key }))
  addEventListener('securitypolicyviolation', event => probe.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }))
  document.write(`<link rel="stylesheet" href="${css}"><div class="gist"><pre>Fixed synthetic Gist ${id}</pre><input aria-label="合成Gist输入"><button type="button">合成按钮</button><div class="scroll-space">合成滚动内容</div></div>`)
  document.querySelector('link').addEventListener('load', () => { probe.css = true })
  addEventListener('message', event => {
    const { kind, parentOrigin } = event.data || {}
    if (kind === 'gist-fixture-navigate') { location.href = parentOrigin + '/api/health?__gist_probe=self-navigation'; return }
    if (kind !== 'gist-fixture-attacks' || probe.attacksStarted) return
    probe.attacksStarted = true
    const attempt = (label, run) => {
      try { const result = run(); probe.attempts.push({ label, result: typeof result === 'string' || result === null ? result : 'returned' }) }
      catch (error) { probe.attempts.push({ label, error: error.name }) }
    }
    const script = source => { const node = document.createElement('script'); node.src = source; document.head.append(node) }
    attempt('parent-dom', () => { parent.document.documentElement.dataset.gistEscaped = 'true' })
    attempt('parent-storage', () => parent.localStorage.setItem('gist-escaped', 'true'))
    attempt('top-dom', () => top.document.title)
    attempt('remove-sandbox', () => frameElement.removeAttribute('sandbox'))
    attempt('neighbor-dom', () => parent.frames[1].document.title)
    attempt('neighbor-storage', () => parent.frames[1].localStorage.getItem('gist-private'))
    attempt('own-storage', () => { localStorage.setItem('gist-private', id); return localStorage.getItem('gist-private') })
    attempt('opener', () => opener)
    attempt('inline-script', () => { const node = document.createElement('script'); node.textContent = "window.__gistFixture.executions.push('inline')"; document.head.append(node) })
    attempt('event-attribute', () => { const node = document.createElement('button'); node.setAttribute('onclick', "window.__gistFixture.executions.push('event')"); document.body.append(node); node.click() })
    attempt('eval', () => eval("window.__gistFixture.executions.push('eval')"))
    attempt('meta-csp', () => { const node = document.createElement('meta'); node.httpEquiv = 'Content-Security-Policy'; node.content = "script-src * 'unsafe-inline' 'unsafe-eval'"; document.head.append(node); const script = document.createElement('script'); script.textContent = "window.__gistFixture.executions.push('meta')"; document.head.append(script) })
    attempt('other-id-script', () => script(`https://gist.github.com/${otherId}.js`))
    attempt('other-path-script', () => script(`https://gist.github.com/${id}.js/other`))
    attempt('foreign-script', () => script('https://gist-tests.invalid/script.js'))
    attempt('image', () => { const image = new Image(); image.src = 'https://gist-tests.invalid/image.png'; document.body.append(image) })
    attempt('font', () => { const style = document.createElement('style'); style.textContent = "@font-face{font-family:GistProbe;src:url(https://gist-tests.invalid/font.woff2)}"; document.head.append(style); document.fonts.load('12px GistProbe').catch(() => {}) })
    attempt('preload', () => { const node = document.createElement('link'); node.rel = 'preload'; node.as = 'script'; node.href = 'https://gist-tests.invalid/preload.js'; document.head.append(node) })
    attempt('subframe', () => { const node = document.createElement('iframe'); node.src = 'https://gist-tests.invalid/frame'; document.body.append(node) })
    attempt('object', () => { const node = document.createElement('object'); node.data = 'https://gist-tests.invalid/object'; document.body.append(node) })
    attempt('fetch', () => { fetch(parentOrigin + '/api/health?__gist_probe=csp-fetch').catch(() => {}) })
    attempt('xhr', () => { const xhr = new XMLHttpRequest(); xhr.open('GET', parentOrigin + '/api/health?__gist_probe=csp-xhr'); xhr.send() })
    attempt('websocket', () => { const socket = new WebSocket(parentOrigin.replace('http:', 'ws:') + '/?__gist_probe=csp-ws'); socket.onerror = () => {} })
    attempt('form', () => { const form = document.createElement('form'); form.action = parentOrigin + '/api/content-host/instances?__gist_probe=form'; form.method = 'POST'; document.body.append(form); form.submit() })
    attempt('popup', () => window.open('https://gist-tests.invalid/popup'))
    attempt('top-navigation', () => { top.location.href = parentOrigin + '/?__gist_probe=top-navigation' })
    attempt('download', () => { const node = document.createElement('a'); node.href = 'data:text/plain,synthetic'; node.download = 'gist-must-not-download.txt'; document.body.append(node); node.click() })
    for (const action of ['play', 'edit', 'capture', 'fetch', 'save']) {
      const channel = new MessageChannel(); channel.port1.onmessage = event => probe.messages.push(event.data)
      parent.postMessage({ protocol: 'hicanvas-content', action, instanceId: 'old-instance', requestId: action }, parentOrigin, [channel.port2])
    }
    probe.attacksComplete = true
  })
  if (broken) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://gist-tests.invalid/unknown.css'; document.head.append(link) }
  console.info('HICANVAS_GIST_FIXTURE ' + JSON.stringify({ kind: 'ready', id, origin: location.origin }))
}
const normal = id => `(${fixtureScript})(${JSON.stringify(id)},${JSON.stringify(cssUrl)},${JSON.stringify(GIST_FIXTURE_IDS[1])},${id === GIST_FIXTURE_IDS[2]});`

// This is an optional *test-only* hook. No normal suite can install it.
export function createGistFixtureAdapter({ key, manifest, session }) {
  if (!manifest.embedsOnly || !['embed-editing', 'gist-security'].includes(key)) return null
  if (retired.has(session)) return null
  if (adapters.has(session)) return adapters.get(session)
  const audit = { matched: [], fulfilled: [], denied: [] }
  const sources = new Map(GIST_FIXTURE_IDS.map(id => [`https://gist.github.com/${id}.js`, { type: 'script', contentType: 'text/javascript; charset=utf-8', body: normal(id) }]))
  sources.set(cssUrl, { type: 'stylesheet', contentType: 'text/css; charset=utf-8', body: '.gist { white-space: pre-wrap; } .scroll-space { height: 1200px; }' })
  let disposed = false
  session.protocol.handle('https', request => {
    const source = !disposed && request.method === 'GET' && sources.get(request.url)
    if (!source) { audit.denied.push({ url: request.url, method: request.method }); return new Response('Fixture request denied', { status: 403 }) }
    audit.fulfilled.push({ url: request.url, sha256: createHash('sha256').update(source.body).digest('hex') })
    return new Response(source.body, { headers: { 'content-type': source.contentType, 'cache-control': 'no-store' } })
  })
  const adapter = Object.freeze({
    audit,
    match(details) {
      const source = !disposed && details.method === 'GET' && sources.get(details.url)
      if (!source || details.resourceType !== source.type) return null
      audit.matched.push({ url: details.url, resourceType: details.resourceType })
      return 'local'
    },
    // Never restore real HTTPS while an allowed request may still be in flight.
    // This deny handler lives only until the owned session/process is destroyed.
    dispose() { if (!disposed) { disposed = true; retired.add(session); adapters.delete(session) } },
  })
  adapters.set(session, adapter)
  return adapter
}

export function allowGistFixtureRequest(adapter, details) {
  try {
    const result = adapter?.match(details)
    if (result && typeof result.then === 'function') { void Promise.resolve(result).catch(() => {}); return false }
    return result === 'local'
  } catch { return false }
}

export const getGistFixtureAdapter = session => adapters.get(session) || null

export function isExpectedGistConsoleError(message) {
  // A page exception must never become an expected policy refusal merely
  // because its own text mentions a frame, CSP or a network error code.
  if (/\b(?:Uncaught|Unhandled|ReferenceError|TypeError|SyntaxError)\b/i.test(message)) return false
  return /^Failed to load resource: net::ERR_(?:BLOCKED_BY_CLIENT|BLOCKED_BY_RESPONSE|FAILED)$/.test(message)
    || /^Failed to load resource: the server responded with a status of (?:403|404) \(/.test(message)
    || /^(?:Refused to |Loading |Executing |Connecting |Framing |Applying ).*Content Security Policy/.test(message)
    || /^Refused to display .* in a frame because it set 'X-Frame-Options'/.test(message)
    || /^Blocked (?:opening|form submission|script execution|automatic download)\b/i.test(message)
    || /^Unsafe attempt to (?:initiate navigation|navigate)\b/.test(message)
    || /^Download is disallowed\. The frame .*sandboxed/.test(message)
    || /^Access to (?:fetch|XMLHttpRequest) at 'http:\/\/127\.0\.0\.1:\d+\/[^']*__gist_probe=/.test(message)
    || /^Fetch API cannot load http:\/\/127\.0\.0\.1:\d+\/api\/health\?__gist_probe=csp-fetch\. Refused to connect because it violates the document's Content Security Policy\.$/.test(message)
}

// Scoped to the owned Electron test process. The Socket boundary also covers
// Node HTTP/fetch; no hostname resolution or external connection is delegated.
export function installGistNodeBoundary(origins) {
  const ports = new Set(origins.map(value => {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('Gist Node boundary requires owned loopback origins')
    return Number(url.port)
  }))
  const original = net.Socket.prototype.connect, denied = []
  function guarded(...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0]
    const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
    if (options.host !== '127.0.0.1' || !ports.has(Number(options.port)) || options.path) {
      denied.push({ host: options.host || 'localhost', port: options.port, path: options.path })
      throw new Error('Gist test Node outbound denied')
    }
    return original.apply(this, args)
  }
  net.Socket.prototype.connect = guarded
  return { denied, dispose() { if (net.Socket.prototype.connect === guarded) net.Socket.prototype.connect = original } }
}
