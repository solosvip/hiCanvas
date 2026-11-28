import { request as httpRequest } from 'node:http'
import net from 'node:net'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { GIST_FIXTURE_IDS, createGistFixtureAdapter, getGistFixtureAdapter, installGistNodeBoundary, isExpectedGistConsoleError } from './gist-fixtures.mjs'

const check = (value, label) => { if (!value) throw new Error(label) }
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
// Store insertion order changes after undo; the saved index still defines z-order.
const signature = records => JSON.stringify(canonical([...records].sort((a, b) => a.id.localeCompare(b.id))))
const digest = value => createHash('sha256').update(signature(value)).digest('hex')
async function until(run, label) {
  const end = Date.now() + 15000
  while (Date.now() < end) { const result = await run(); if (result) return result; await delay(25) }
  throw new Error(`Gist 原生检查超时：${label}`)
}
// Node connects only to loopback. The random Host is still checked by the real
// content server; this does not grant the parent browser cross-origin reads.
function readPublication(value) {
  const url = new URL(value)
  check(url.protocol === 'http:' && /^[a-f0-9]{48}\.localhost$/.test(url.hostname) && url.port, '不是本次随机内容来源')
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: url.port, path: url.pathname, headers: { host: url.host } }, response => {
      const parts = []; response.on('data', part => parts.push(part)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts).toString() }))
    })
    request.on('error', reject); request.end()
  })
}

async function interceptResponses(debug, pattern, transform) {
  if (!debug.isAttached()) debug.attach('1.3')
  const errors = []
  const listener = (_event, method, params) => {
    if (method !== 'Fetch.requestPaused') return
    void (async () => {
      try {
        const result = await transform(params, async () => {
          const value = await debug.sendCommand('Fetch.getResponseBody', { requestId: params.requestId })
          return value.base64Encoded ? Buffer.from(value.body, 'base64').toString() : value.body
        })
        if (!result) return debug.sendCommand('Fetch.continueRequest', { requestId: params.requestId })
        if (result.errorReason) return debug.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: result.errorReason })
        const headers = params.responseHeaders.filter(row => !['content-length', 'transfer-encoding'].includes(row.name.toLowerCase()))
        await debug.sendCommand('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: result.status || params.responseStatusCode, responseHeaders: headers, body: Buffer.from(result.body).toString('base64') })
      } catch (error) { errors.push(error.message); await debug.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' }).catch(() => {}) }
    })()
  }
  debug.on('message', listener)
  await debug.sendCommand('Fetch.enable', { patterns: [{ urlPattern: pattern, requestStage: 'Response' }] })
  return async () => { await debug.sendCommand('Fetch.disable'); debug.off('message', listener); check(!errors.length, 'Gist受控响应截获失败：' + errors.join(';')) }
}

// Only the dedicated embeds suite supplies createWindow. Child observations
// execute in our fixed fake script's own realm, never by parent DOM access.
export async function gistSecuritySmoke(parentWindow, output, createWindow, prepareBrowserBoundary) {
  const { BrowserWindow } = await import('electron')
  check(typeof createWindow === 'function', 'Gist专项缺少显式可选宿主钩子')
  check(typeof prepareBrowserBoundary === 'function', 'Gist专项缺少独立窗口浏览器剪贴板守卫')
  const origin = new URL(parentWindow.webContents.getURL()).origin
  const audit = { requests: [], blocked: [], errors: [], executions: [] }
  const probeWindow = createWindow('gist-security', audit, createGistFixtureAdapter)
  const wc = probeWindow.webContents, evaluate = code => wc.executeJavaScript(code)
  const stages = [], completions = [], publications = [], unexpected = [], windowAudit = []
  let visibilityError
  const hiddenState = phase => ({ phase, visible: probeWindow.isVisible(), focusedWindowId: BrowserWindow.getFocusedWindow()?.id ?? null })
  const assertHidden = phase => {
    const value = hiddenState(phase); windowAudit.push(value)
    check(!visibilityError && value.visible === false && value.focusedWindowId === null, 'Gist专用窗口出现或应用获得系统前台焦点')
  }
  const rejectVisible = () => { windowAudit.push(hiddenState('visibility-event')); visibilityError = new Error('Gist专用窗口出现或获得系统焦点'); probeWindow.destroy() }
  probeWindow.on('show', rejectVisible); probeWindow.on('focus', rejectVisible)
  const adapter = getGistFixtureAdapter(wc.session)
  check(adapter, 'Gist专项没有安装固定本地响应适配器')
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  const observe = async (label, evidence) => {
    assertHidden(label)
    const value = await state().catch(() => null)
    stages.push({ label, evidence, revision: value?.revision, commitCalls: value?.commitCalls, recordsSha256: value?.embedRecords && digest(value.embedRecords) })
    await writeFile(join(output, 'gist-native.json'), JSON.stringify({ stages, audit, completions, fixtures: adapter.audit, windowAudit }, null, 2))
  }
  // A CORS-rejected response may end in onErrorOccurred instead of onCompleted.
  // Record the actual HTTP headers before the browser applies that boundary.
  wc.session.webRequest.onHeadersReceived((details, callback) => { if (details.url.includes('__gist_probe=')) completions.push({ url: details.url, method: details.method, status: details.statusCode }); callback({ cancel: false }) })
  let popupCount = 0, downloadCount = 0, boundary
  wc.setWindowOpenHandler(() => { popupCount++; return { action: 'deny' } })
  const download = event => { downloadCount++; event.preventDefault() }
  wc.session.on('will-download', download)
  const fixtureURL = new URL(parentWindow.webContents.getURL()); fixtureURL.searchParams.set('embedCase', 'gist'); fixtureURL.searchParams.set('edgeScrolling', '0')
  const frameSelector = id => `[data-embed-content="${id}"]`
  const frameURL = id => evaluate(`document.querySelector(${JSON.stringify(frameSelector(id))})?.src`)
  const child = id => until(async () => { const url = await frameURL(id); return url && wc.mainFrame.frames.find(frame => frame.url === url) }, '合成Gist子上下文')
  const readChild = async (id, code) => (await child(id)).executeJavaScript(code)
  const attrs = id => evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(frameSelector(id))});return f&&{src:f.src,sandbox:f.getAttribute('sandbox'),allow:f.getAttribute('allow'),tab:f.tabIndex,pointer:f.style.pointerEvents,owner:f.dataset.canvasInputOwner}})()`)
  const focus = () => evaluate('document.querySelector("#canvas").focus({preventScroll:true})')
  async function key(keyCode, modifiers = []) { for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers }); await delay(40) }
  async function click(selector) {
    const point = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.hidden||n.disabled)throw Error('Gist合成控件不可用');const r=n.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 })
    await delay(40)
  }
  async function enter(id) { await delay(450); await click(frameSelector(id)); await click(frameSelector(id)); await until(async () => (await state()).interactingEmbedId === id, '两次真实点击进入Gist') }
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  try {
    assertHidden('created')
    const clipboardProof = await prepareBrowserBoundary(probeWindow)
    await observe('independent-window-clipboard-boundary', clipboardProof)
    // First prove the optional hook through the actual shared request guard.
    // No page CSP masks these three forbidden requests in this detector proof.
    const good = `https://gist.github.com/${GIST_FIXTURE_IDS[0]}.js`
    const bad = [good + '/other', 'https://gist-tests.invalid/unlisted.js']
    const proof = `<script>window.guardErrors=[]</script><script src="${good}"></script>` + bad.map(url => `<script src="${url}" onerror="guardErrors.push(${JSON.stringify(url).replaceAll('"', '&quot;')})"></script>`).join('') + `<img src="${good}" onerror="guardErrors.push('wrong-resource')">`
    await probeWindow.loadURL('data:text/html,' + encodeURIComponent(proof))
    await until(() => evaluate('window.guardErrors?.length===3 && window.__gistFixture?.css'), '共用请求守卫红绿')
    check(bad.every(url => audit.blocked.includes(url)) && audit.blocked.includes(good), '未登记URL/同主机其他路径/其他资源类型没有被取消')
    check(adapter.audit.fulfilled.some(row => row.url === good) && !adapter.audit.fulfilled.some(row => bad.includes(row.url)), '正常精确脚本未本地满足或坏URL被满足')
    check(audit.errors.every(isExpectedGistConsoleError), '请求守卫证明出现未分类异常：' + JSON.stringify(audit.errors))
    await observe('request-hook-red-green', { denied: [...bad, { url: good, type: 'image' }], allowed: good, consoleErrors: [...audit.errors] })

    await probeWindow.loadURL(fixtureURL.href)
    const initial = await until(async () => { const s = await state(); return s?.ready && await frameURL('shape:gist-a') && await frameURL('shape:gist-b') && s }, '两个独立Gist')
    const a = 'shape:gist-a', b = 'shape:gist-b', first = await attrs(a), second = await attrs(b)
    const baseline = signature(initial.embedRecords), revision = initial.revision, parentURL = wc.getURL()
    check(first.src !== second.src && new URL(first.src).origin !== origin && new URL(first.src).origin !== new URL(second.src).origin, '随机Gist来源不独立')
    check(first.sandbox === 'allow-scripts allow-same-origin' && first.allow === null, 'Gist获得了额外沙箱/设备权限')
    boundary = installGistNodeBoundary([origin, `http://127.0.0.1:${new URL(first.src).port}`])
    let nodeDenied = false
    try { net.connect({ host: 'gist-tests.invalid', port: 443 }) } catch (error) { nodeDenied = error.message.includes('Node outbound denied') }
    check(nodeDenied && boundary.denied.length === 1, 'Node出站拒绝桩未生效')
    await observe('random-origins-and-node-boundary', { first, second, nodeDenied })
    const response = await readPublication(first.src), csp = response.headers['content-security-policy']
    check(response.status === 200 && csp.includes(`https://gist.github.com/${GIST_FIXTURE_IDS[0]}.js`) && !csp.includes('unsafe-eval') && !csp.includes("script-src 'unsafe-inline'"), '固定包装的真实HTTP策略错误')
    const bootstrap = response.body.match(/<script>([^]*?)<\/script>/)?.[1]
    check(bootstrap && csp.includes(`'sha256-${createHash('sha256').update(bootstrap).digest('base64')}'`), '真实固定bootstrap和哈希不符')
    for (const path of ['/.hicanvas-channel/' + new URL(first.src).hostname.split('.')[0] + '/bootstrap.js', '/edit-source.txt', '/api/canvas']) check((await readPublication(new URL(path, first.src).href)).status === 404, 'Gist实例暴露了额外文件')
    await observe('fixed-publication-no-channel', { csp, wrapperSha256: createHash('sha256').update(response.body).digest('hex') })
    await until(() => readChild(a, 'window.__gistFixture?.css && !document.querySelector("#hicanvas-gist-status")'), '精确官方脚本和CSS本地显示')
    check(await readChild(a, 'typeof require==="undefined" && typeof process==="undefined"'), '子页获得Node能力')
    check(await readChild(a, 'window.__hicanvasEmbedClipboardBoundary?.check() && window.__embedClipboardViolations.length===0') && await readChild(b, 'window.__hicanvasEmbedClipboardBoundary?.check() && window.__embedClipboardViolations.length===0'), '独立Gist子框缺少浏览器剪贴板守卫')
    check(first.pointer === 'none' && first.tab === -1 && second.pointer === 'none' && second.tab === -1, 'Gist初始开放了输入')
    await observe('normal-script-css-passive', { localFulfilled: adapter.audit.fulfilled })
    check(await evaluate(`(()=>{try{document.querySelector(${JSON.stringify(frameSelector(a))}).contentWindow.document;return false}catch(e){return e.name==='SecurityError'}})()`), '父页可读Gist子DOM')
    const otherScript = `https://gist.github.com/${GIST_FIXTURE_IDS[1]}.js`
    await until(() => readChild(b, 'window.__gistFixture?.css'), '相邻Gist已真实加载')
    const otherScriptLoads = adapter.audit.fulfilled.filter(row => row.url === otherScript).length
    await evaluate(`document.querySelector(${JSON.stringify(frameSelector(a))}).contentWindow.postMessage({kind:'gist-fixture-attacks',parentOrigin:location.origin},new URL(${JSON.stringify(first.src)}).origin)`)
    await until(() => readChild(a, 'window.__gistFixture?.attacksComplete && window.__gistFixture.violations.length>=8'), '恶意假官方脚本尝试')
    await delay(200)
    const attack = await readChild(a, 'JSON.parse(JSON.stringify(window.__gistFixture))')
    const blockedLabels = ['parent-dom', 'parent-storage', 'top-dom', 'remove-sandbox', 'neighbor-dom', 'neighbor-storage', 'eval', 'top-navigation']
    check(blockedLabels.every(label => attack.attempts.find(row => row.label === label)?.error), '父/相邻实例隔离或eval/top沙箱反例未触发拒绝')
    check(attack.attempts.find(row => row.label === 'own-storage')?.result === GIST_FIXTURE_IDS[0] && !attack.executions.length && !attack.messages.length, '自己的来源不可用、恶意脚本执行或伪消息得到能力')
    await observe('parent-neighbor-and-storage-red-green', { attempts: attack.attempts.filter(row => blockedLabels.includes(row.label) || row.label === 'own-storage') })
    for (const directive of ['script-src-elem', 'script-src-attr', 'connect-src', 'frame-src', 'object-src', 'img-src', 'font-src']) check(attack.violations.some(row => row.directive === directive), 'CSP未记录拒绝：' + directive)
    check(adapter.audit.fulfilled.filter(row => row.url === otherScript).length === otherScriptLoads, '另一ID脚本突破精确CSP')
    check(popupCount === 0 && downloadCount === 0, '沙箱未阻断弹窗或下载')
    await observe('csp-sandbox-resource-refusals', { attempts: attack.attempts, violations: attack.violations, popupCount, downloadCount })
    check(wc.getURL() === parentURL && (await state()).revision === revision && signature((await state()).embedRecords) === baseline && await evaluate('!document.documentElement.dataset.gistEscaped && !localStorage.getItem("gist-escaped")'), '恶意脚本改变父身份/画板')
    check(!completions.some(row => row.url.includes('csp-')), 'connect-src没有在父API之前拒绝请求')
    await observe('forged-messages-no-parent-capability', { replies: attack.messages, parentUnchanged: true, parentApiAccepted: 0 })

    // Separate generated publication intentionally bypasses Gist CSP. It still
    // has a random origin and the unchanged parent HTTP gate must reject it.
    const gateScript = `for(const [method,headers] of [['GET',{}],['POST',{'content-type':'application/json','x-hicanvas-client':'1'}]])fetch(${JSON.stringify(origin)}+'/api/content-host/instances?__gist_probe=second-gate-'+method,{method,headers,body:method==='POST'?'{}':undefined}).catch(()=>{});`
    const gate = await evaluate(`fetch('/api/content-host/instances',{method:'POST',headers:{'content-type':'application/json','x-hicanvas-client':'1'},body:JSON.stringify({html:${JSON.stringify('<!doctype html><script>' + gateScript + '</script>')},conversationId:'legacy'})}).then(async r=>{if(!r.ok)throw Error('二道门夹具登记失败');return r.json()})`)
    publications.push(gate)
    await evaluate(`(()=>{const f=document.createElement('iframe');f.id='gist-second-gate';f.src=${JSON.stringify(gate.url)};f.setAttribute('sandbox','allow-scripts allow-same-origin');document.body.append(f)})()`)
    await until(() => completions.filter(row => row.url.includes('second-gate-')).length >= 2, '独立父服务二道门')
    const secondGate = completions.filter(row => row.url.includes('second-gate-'))
    check(secondGate.every(row => row.status === 403) && secondGate.some(row => row.method === 'GET') && secondGate.some(row => row.method === 'OPTIONS' || row.method === 'POST'), '父服务未拒绝跨来源请求或伪客户端')
    await observe('parent-http-second-gate', secondGate)
    await evaluate('document.querySelector("#gist-second-gate").remove()')
    await evaluate(`document.querySelector(${JSON.stringify(frameSelector(a))}).contentWindow.postMessage({kind:'gist-fixture-navigate',parentOrigin:location.origin},new URL(${JSON.stringify(first.src)}).origin)`)
    await until(() => completions.some(row => row.url.includes('__gist_probe=self-navigation') && row.status === 403), '子框自导航被父服务拒绝')
    check(wc.getURL() === parentURL && (await state()).revision === revision, '子框自导航改变了父页')
    await observe('self-navigation-attempt-rejected', completions.filter(row => row.url.includes('self-navigation')))

    // Preserve the real HTTP CSP while changing exactly one bootstrap byte.
    // The same permitted official script still runs, but the changed inline
    // script must fail its hash and cannot remove the loading status.
    let tampered = false
    const stopTamper = await interceptResponses(wc.debugger, 'http://*.localhost:*/gist.html', async (_params, body) => {
      const html = await body()
      if (!html.includes(`/${GIST_FIXTURE_IDS[0]}.js`)) return null
      tampered = true; return { body: html.replace('</script>', ' </script>') }
    })
    try {
      await probeWindow.loadURL(fixtureURL.href)
      await until(() => readChild(a, 'window.__gistFixture?.css && document.querySelector("#hicanvas-gist-status")?.textContent.includes("加载中")'), '一字节bootstrap篡改被哈希拒绝')
      check(tampered && audit.errors.some(message => /inline|hash/i.test(message) && /Content Security Policy|script-src/i.test(message)), '篡改反例未检测到真实CSP拒绝')
      await observe('bootstrap-one-byte-tamper-rejected', { bytesAdded: 1, headerUnchanged: true })
    } finally { await stopTamper() }
    const brokenURL = new URL(fixtureURL); brokenURL.searchParams.set('embedCase', 'gist-broken')
    await probeWindow.loadURL(brokenURL.href)
    await until(() => readChild(a, 'window.__gistFixture?.css && document.querySelector("#hicanvas-gist-status")?.textContent.includes("失败")'), '未知样式依赖明确显示失败')
    check(!adapter.audit.fulfilled.some(row => row.url.includes('unknown.css')), '未知样式被放行')
    await observe('unknown-dependency-visible-failure', { unknownCssFulfilled: false })

    // Reopen clean Gists for real input, history and lifetime checks.
    await probeWindow.loadURL(fixtureURL.href)
    await until(() => readChild(a, 'window.__gistFixture?.css && !document.querySelector("#hicanvas-gist-status")'), '正常Gist重新挂载')
    const clean = await state(), cleanSignature = signature(clean.embedRecords), cleanURL = await frameURL(a)
    await enter(a)
    check((await attrs(a)).pointer === 'auto' && (await attrs(a)).tab === 0 && (await attrs(a)).owner === 'embed' && (await attrs(b)).pointer === 'none', '真实进入未形成唯一输入归属')
    await observe('native-double-click-single-owner', await attrs(a))
    const input = await readChild(a, '(()=>{const r=document.querySelector("input").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()')
    const offset = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(frameSelector(a))}).getBoundingClientRect();return{x:r.x,y:r.y}})()`)
    check(await evaluate(`document.elementFromPoint(${offset.x + input.x},${offset.y + input.y})===document.querySelector(${JSON.stringify(frameSelector(a))})`), '子输入被父页面覆盖')
    // Electron 42.5.0 cannot click-focus an OOPIF in offscreen or hidden views;
    // direct child mouse/text dispatch causes SIGSEGV. Keep native double-click,
    // real DOM focus and parent shortcut refusal. Real-window typing is manual
    // if the native character route cannot reach this cross-process child.
    await evaluate(`document.querySelector(${JSON.stringify(frameSelector(a))}).focus({preventScroll:true})`)
    check(await readChild(a, '(()=>{document.querySelector("input").focus();return document.activeElement?.tagName==="INPUT"})()'), '真实DOM聚焦子输入失败')
    check(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(frameSelector(a))})`), '父页面焦点未归隔离子框')
    for (const keyCode of 'Gist 独有输入') wc.sendInputEvent({ type: 'char', keyCode })
    let nativeInputVerified = true
    try { await until(() => readChild(a, 'document.querySelector("input").value.includes("Gist 独有输入")'), '原生字符到子框') }
    catch (error) { if (error.message !== 'Gist 原生检查超时：原生字符到子框') throw error; nativeInputVerified = false }
    const childInput = await readChild(a, 'window.__gistFixture.inputs')
    if (nativeInputVerified) check(childInput.some(row => row.type === 'input' && row.target === 'INPUT' && row.trusted), '子输入没有收到可信原生input事件')
    await observe('native-input-in-child', { mode: nativeInputVerified ? '原生双击 + 真实 DOM 聚焦 + 原生字符输入' : '原生双击 + 真实 DOM 聚焦；真实窗口打字待用户验证', nativeInputVerified, syntheticChild: true, parentFocus: await evaluate('document.activeElement?.tagName'), childFocus: await readChild(a, 'document.activeElement?.tagName'), events: childInput })
    const keys = nativeInputVerified ? [['Escape', []], ['H', []], ['Right', []], ['Z', [mod]]] : [['Delete', []], ['Z', [mod]], ['H', []]]
    for (const [code, modifiers] of keys) await key(code, modifiers)
    if (nativeInputVerified) check((await readChild(a, 'window.__gistFixture.inputs')).filter(row => row.type === 'keydown' && row.trusted).length >= 4, '子框未收到四个可信原生按键')
    check((await state()).interactingEmbedId === a && signature((await state()).embedRecords) === cleanSignature, 'Gist子框快捷键误改画板')
    const childValueAfterKeys = await readChild(a, 'document.querySelector("input").value')
    await observe('child-shortcuts-do-not-edit-canvas', { revision: (await state()).revision, nativeInputVerified, keys })
    await click('[data-embed-action=finish-interaction]'); await until(async () => !(await state()).interactingEmbedId, '父按钮退出')
    check(await evaluate('document.activeElement===document.querySelector("#canvas")') && (await attrs(a)).pointer === 'none', '退出未归还画布焦点或仍放行输入')
    await observe('parent-button-exit', await attrs(a))
    await evaluate(`void(window.__gistSavedFrame=document.querySelector(${JSON.stringify(frameSelector(a))}))`)
    await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:-100,y:-80,z:.8});void 0')
    await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0')
    check(await frameURL(a) === cleanURL && await readChild(a, 'document.querySelector("input").value') === childValueAfterKeys, '相机变化重建了Gist实例')
    await observe('camera-preserves-instance', { url: cleanURL })
    await enter(a); await focus(); await key('Delete')
    await until(async () => !(await state()).submitting && !(await state()).embedRecords.some(row => row.id === a), '删除Gist')
    check(!(await state()).interactingEmbedId && await evaluate('!window.__gistSavedFrame.isConnected'), '删除残留互动或iframe')
    await until(async () => (await readPublication(cleanURL)).status === 403, '删除撤销内容租约')
    await observe('delete-detaches-and-revokes', { oldUrl: cleanURL })
    await key('Z', [mod]); await until(() => frameURL(a), '删除撤销新实例')
    const restored = await frameURL(a)
    check(restored !== cleanURL && !(await state()).interactingEmbedId && (await attrs(a)).pointer === 'none', '撤销复活了旧实例或互动')
    await observe('undo-new-passive-instance', { restored })
    await click(frameSelector(a)); await click('[data-embed-action=convert-bookmark]')
    await until(async () => (await state()).selectedShapes[0]?.type === 'bookmark', 'Gist转书签')
    await until(async () => (await readPublication(restored)).status === 403, '互转撤销租约')
    check(!await frameURL(a), '转书签仍残留Gist iframe')
    await observe('conversion-revokes-instance', { oldUrl: restored })
    await key('Z', [mod]); await until(() => frameURL(a), '互转一步撤销')
    check(await frameURL(a) !== restored && signature((await state()).embedRecords) === cleanSignature, '转换撤销未恢复记录或复用旧实例')
    await observe('conversion-undo-new-instance', { url: await frameURL(a) })

    // The real public loader registers first; only its reply is held locally.
    const cancelled = await evaluate(`(async()=>{const {loadGistFrame}=await import('/renderer/index.js');let unblock,instance;const held=new Promise(r=>unblock=r),controller=new AbortController();let posted;const postedPromise=new Promise(r=>posted=r);const fetcher=async(url,options)=>{const r=await fetch(url,options);if(options?.method==='POST'){instance=await r.clone().json();posted();await held}return r};const pending=loadGistFrame(${JSON.stringify(GIST_FIXTURE_IDS[0])},{fetcher,signal:controller.signal}).then(()=>false,()=>true);await postedPromise;controller.abort();unblock();return{rejected:await pending,url:instance.url}})()`)
    check(cancelled.rejected, '取消后迟到结果仍成功')
    await until(async () => (await readPublication(cancelled.url)).status === 403, '取消迟到实例撤销')
    await observe('cancelled-late-registration-revoked', cancelled)

    // Shorten only this test's response DTO, then fail the real PUT response.
    // The actual server TTL and renewal implementation remain unchanged.
    let renewDenied = 0
    const leaseResponses = []
    const stopLease = await interceptResponses(wc.debugger, origin + '/api/content-host/instances', async (params, body) => {
      leaseResponses.push({ method: params.request.method, status: params.responseStatusCode, action: params.request.method === 'PUT' ? 'network-refused' : 'response' })
      await writeFile(join(output, 'gist-lease-responses.json'), JSON.stringify(leaseResponses, null, 2))
      if (params.request.method === 'POST' && params.responseStatusCode === 201) {
        const value = JSON.parse(await body()); value.leaseMs = 4000; return { body: JSON.stringify(value) }
      }
      if (params.request.method === 'PUT') { renewDenied++; return { errorReason: 'BlockedByClient' } }
      return null
    })
    try {
      await probeWindow.loadURL(fixtureURL.href)
      await until(() => readChild(a, 'window.__gistFixture?.css'), '续租失败夹具正常显示')
      const beforeLease = await state(), leaseURLs = [await frameURL(a), await frameURL(b)]
      await enter(a)
      await until(async () => renewDenied > 0 && !await frameURL(a) && !(await state()).interactingEmbedId, '续租失败移除iframe并退出互动')
      check(signature((await state()).embedRecords) === signature(beforeLease.embedRecords) && (await state()).revision === beforeLease.revision, '续租失败改写文档')
      check(await evaluate('document.querySelector("[data-shape-id=\\"shape:gist-a\\"] [data-content-placeholder]")?.textContent.includes("失效")'), '续租失败没有明确占位提示')
      for (const url of leaseURLs) await until(async () => (await readPublication(url)).status === 403, '续租失败撤销实例')
      await observe('lease-failure-removes-frame-and-owner', { renewDenied, leaseURLs, failure: 'actual PUT response refused by controlled browser network boundary' })
    } finally { await stopLease() }
    await probeWindow.loadURL(fixtureURL.href)
    await until(() => frameURL(a), '卸载前重新挂载')
    const urlsBeforeUnmount = await evaluate('[...document.querySelectorAll("iframe[data-external-service=G16]")].map(f=>f.src)')
    await probeWindow.loadURL('data:text/html,<title>Gist unmounted</title>')
    for (const url of urlsBeforeUnmount) await until(async () => (await readPublication(url)).status === 403, '换页卸载释放实例')
    await observe('unmount-revokes-all', { urls: urlsBeforeUnmount })
    // Expected malicious probes may log CSP/sandbox/CORS failures. Anything
    // else still fails this suite; ordinary embeds use the original global list.
    unexpected.push(...audit.errors.filter(message => !isExpectedGistConsoleError(message)))
    check(!unexpected.length, 'Gist专项有未分类的浏览器错误：' + JSON.stringify(unexpected))
    const result = { stages, audit, completions, fixtures: adapter.audit, windowAudit, nativeInputVerified, manualTypingRequired: !nativeInputVerified, nodeDenied: boundary.denied, parentApiAccepted: completions.filter(row => row.url.includes('__gist_probe=') && row.status < 400).length, unexpected, onlineCompatibility: 'unknown', syntheticResponsesOnly: true }
    check(result.parentApiAccepted === 0, '父接口接受了恶意请求')
    await writeFile(join(output, 'gist-native.json'), JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    try {
      const frames = await Promise.all(wc.mainFrame.frames.map(async frame => ({ url: frame.url, evidence: await frame.executeJavaScript('({fixture:window.__gistFixture,focused:document.hasFocus(),active:document.activeElement?.tagName,input:document.querySelector("input")?.value,status:document.querySelector("#hicanvas-gist-status")?.textContent,links:[...document.querySelectorAll("link")].map(n=>({href:n.href,sheet:!!n.sheet}))})').catch(e => ({ error: e.message })) })))
      await writeFile(join(output, 'gist-failure.json'), JSON.stringify({ error: error.message, audit, fixtures: adapter.audit, completions, frames, windowAudit, parent: await evaluate('({state:window.__HICANVAS_RENDERER_PREVIEW__?.getState(),active:document.activeElement?.tagName,owner:document.activeElement?.dataset.canvasInputOwner})') }, null, 2))
    } catch { /* Diagnostic capture must preserve the original failure. */ }
    try { await writeFile(join(output, 'gist-failure.png'), (await wc.capturePage()).toPNG()) } catch { /* Preserve the original failure if capture also fails. */ }
    throw error
  } finally {
    for (const instance of publications) await fetch(origin + '/api/content-host/instances', { method: 'DELETE', headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: JSON.stringify({ id: instance.id, revokeToken: instance.revokeToken }) }).catch(() => {})
    wc.session.webRequest.onHeadersReceived(null); wc.session.off('will-download', download); adapter.dispose(); boundary?.dispose()
    if (!probeWindow.isDestroyed()) { assertHidden('before-destroy'); probeWindow.destroy() }
  }
}
