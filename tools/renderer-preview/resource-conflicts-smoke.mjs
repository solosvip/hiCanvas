import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { rasterFiles } from './image-fixtures.js'
import { videoData } from './video-fixtures.js'

const check = (value, message) => { if (!value) throw new Error(message) }
export async function prepareResourceConflictsProbe(context) {
  const { prepareShapeLinksProbe } = await import('./shape-links-smoke.mjs')
  return prepareShapeLinksProbe(context)
}

export async function resourceConflictsSmoke(window, output, probe, origin) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code), requests = [], samples = []
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  const gate = 'window.__HICANVAS_RESOURCE_CONFLICTS_PROBE__', otherId = 'shape:resource-conflicts-other'
  const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  let board, targetId, pageId
  async function until(predicate, label) {
    const end = Date.now() + 15000
    while (Date.now() < end) { const s = await state(); if (s?.error) throw new Error(s.error); if (s && await predicate(s)) return s; await delay(20) }
    throw new Error(`${label}超时：${JSON.stringify(await state()).slice(0, 1000)}`)
  }
  async function read() {
    const response = await fetch(`${origin}/api/canvas?conversation=${board.conversationId}`, { headers: { 'x-hicanvas-client': '1' } })
    check(response.ok, '合成板读取失败'); return response.json()
  }
  const files = () => readdir(join(output, 'data/canvas/conversations', board.conversationId, 'assets')).then(names => names.sort()).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  async function remote(commands) {
    const response = await fetch(`${origin}/__interaction/commit?conversation=${board.conversationId}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1', 'x-hicanvas-actor': 'remote:239' },
      body: JSON.stringify({ expectedRevision: (await read()).revision, commands }),
    })
    const result = await response.json(); check(response.ok, JSON.stringify(result)); return result
  }
  const listener = (_event, method, params) => {
    if (method === 'Network.responseReceived' || method === 'Network.loadingFinished') {
      const request = requests.find(request => request.id === params.requestId)
      if (request) { if (params.response) request.status = params.response.status; else request.finished = true }
      return
    }
    if (method !== 'Network.requestWillBeSent') return
    const url = new URL(params.request.url)
    if (url.origin === origin && url.pathname === '/api/canvas' && params.request.method === 'GET') requests.push({ id: params.requestId, path: url.pathname })
    if (params.request.method !== 'POST') return
    if (url.origin === origin && ['/__interaction/commit', '/api/canvas/reference', '/api/canvas/clipboard/copy', '/api/canvas/clipboard/paste'].includes(url.pathname)) requests.push({ id: params.requestId, path: url.pathname, body: JSON.parse(params.request.postData) })
  }
  wc.debugger.on('message', listener); await wc.debugger.sendCommand('Network.enable')
  const commits = () => requests.filter(request => ['/__interaction/commit', '/api/canvas/clipboard/paste'].includes(request.path))
  const aborted = () => requests.some(request => request.body?.purpose === 'file-import-abort' && request.finished && request.status === 200)
  async function key(keyCode, modifiers = []) {
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers })
    await flush()
  }
  async function point(p) {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 })
    await flush()
  }
  async function load(kind = 'image') {
    const gallery = kind === 'video' ? 'videos' : 'image-import'
    board = await (await fetch(`${origin}/__renderer_fixture?gallery=${gallery}`)).json()
    check(board.persistent && board.conversationId, '资源专项必须使用隔离持久化夹具')
    let current = await read()
    targetId = kind === 'image' ? 'shape:image-0' : Object.values(current.snapshot.store).find(r => r.typeName === 'shape' && r.type === 'video').id
    pageId = Object.values(current.snapshot.store).find(r => r.typeName === 'page').id
    await remote([
      { type: 'update', id: targetId, changes: { x: 100, y: 120 } },
      current.snapshot.store[otherId] ? { type: 'update', id: otherId, changes: { x: 1200 } } : { type: 'create_shape', id: otherId, shapeType: 'geo', x: 1200, y: 700 },
    ])
    await window.loadURL(`${origin}/?gallery=${gallery}&edgeScrolling=0&reduceMotion=1&resourceConflicts=1`)
    await until(s => s.ready && s.imageRecords || s.ready && s.videoRecords, '合成媒体加载')
    await evaluate("document.querySelector('#canvas').focus();window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0")
    const p = await evaluate(`(()=>{const r=document.querySelector('[data-shape-id="${targetId}"]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    await point(p); await until(s => s.selectedIds.length === 1 && s.selectedIds[0] === targetId, '原生选择目标')
    requests.length = 0
  }
  async function clipboard(type, formats = {}) {
    const sent = await evaluate(`(()=>{const data=new DataTransfer();for(const [type,value]of Object.entries(${JSON.stringify(formats)}))data.setData(type,value);const e=new ClipboardEvent(${JSON.stringify(type)},{clipboardData:data,bubbles:true,cancelable:true});document.querySelector('#canvas').dispatchEvent(e);return{trusted:e.isTrusted,prevented:e.defaultPrevented}})()`)
    check(!sent.trusted && sent.prevented, '必须经过不受信的私有ClipboardEvent')
  }
  async function arm(stage, fail = false) { await evaluate(`${gate}.arm(${JSON.stringify(stage)},${fail});void 0`) }
  async function paused(stage) { await until(() => evaluate(`${gate}.inspect().waiting===${JSON.stringify(stage)}`), `${stage}等待闸门`) }
  const release = () => evaluate(`${gate}.release();void 0`)
  async function history(before, saved) {
    await evaluate("document.querySelector('#canvas').focus();void 0"); await key('Z', [mod])
    const undone = await until(s => !s.submitting && s.revision !== saved.revision, '本人一次撤销')
    assert.deepEqual((await read()).snapshot, before.snapshot)
    await key('Z', [mod, 'shift']); await until(s => !s.submitting && s.revision !== undone.revision, '本人一次重做')
    assert.deepEqual((await read()).snapshot, saved.snapshot)
    // Restore the synthetic target for the next case without deleting history.
    await key('Z', [mod]); await until(s => !s.submitting && s.revision !== saved.revision && s.revision !== undone.revision, '恢复下一用例的目标')
  }
  async function remember(label, details) {
    const boundary = await evaluate('({clipboard:window.__embedClipboardViolations,blocked:window.__shapeLinkAudit.blocked,opens:window.__shapeLinkAudit.opens})')
    check(Object.values(boundary).every(calls => calls.length === 0) && !probe.blocked.length && !probe.opens.length, '触碰系统剪贴板、弹窗或导航边界')
    await writeFile(join(output, `${label}.png`), (await wc.capturePage()).toPNG())
    samples.push({ label, ...details, boundary })
    await writeFile(join(output, 'stages.json'), JSON.stringify({ guards: probe.proof, samples }, null, 2))
  }
  async function privateFile(kind, replace) {
    const dataUrl = kind === 'image' ? `data:image/png;base64,${rasterFiles.png.base64}` : videoData.mp4
    // Files remain private DOM values. Replacement clicks are real native
    // buttons; the one synthetic input's click is replaced before it can open
    // any picker, then its ordinary change listener receives the private File.
    await evaluate(`(()=>{const data=new DataTransfer(),raw=atob(${JSON.stringify(dataUrl.split(',')[1])}),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));data.items.add(new File([bytes],'synthetic239.${kind === 'image' ? 'png' : 'mp4'}',{type:${JSON.stringify(kind === 'image' ? 'image/png' : 'video/mp4')}}));if(${replace}){const input=document.querySelector('#image-tools input[type=file]');if(!input)throw Error('缺少既有替换文件入口');Object.defineProperty(input,'click',{value:()=>{input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))}})}else{const e=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});document.querySelector('#canvas').dispatchEvent(e);if(e.isTrusted||!e.defaultPrevented)throw Error('文件粘贴未接管')}})();void 0`)
    if (replace) {
      const p = await evaluate(`(()=>{const n=document.querySelector('[data-${kind}-action=replace]');if(!n||n.disabled)throw Error('替换入口不可用');const r=n.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
      await point(p)
    }
  }
  try {
    for (const action of ['copy', 'cut', 'paste']) for (const related of [false, true]) {
      await load()
      let formats
      if (action === 'paste') { await clipboard('copy'); const copied = await until(s => !s.clipboardBusy && s.privateClipboard.writes === 1, '准备私有内容'); formats = copied.privateClipboard.formats }
      const stage = action === 'copy' ? 'copy' : 'commit'
      await arm(stage); await clipboard(action, formats); await paused(stage)
      const changed = await remote([{ type: 'update', id: related ? action === 'paste' ? pageId : targetId : otherId, changes: related && action === 'paste' ? { name: '远端目标画布' } : { x: 444 } }])
      // A runtime commit serializes its SSE refresh behind the pending save.
      // The confirmed HTTP remote write is enough to create the final race.
      if (stage !== 'commit') await until(s => s.revision === changed.revision, '远端广播')
      await release()
      const finished = await until(s => !s.clipboardBusy && !s.submitting && (action === 'copy' || related ? related ? Boolean(s.lastError) : true : s.revision !== changed.revision), '剪贴板完成')
      const saved = await read()
      check(commits().length === (action === 'copy' ? 0 : 1), '剪贴板修改请求次数不符，可能重发')
      if (related || action === 'copy') assert.deepEqual(saved.snapshot, changed.snapshot)
      else { check(saved.snapshot.store[otherId].x === 444, '覆盖无关远端对象'); await history(changed, saved) }
      if (action === 'copy') check(finished.privateClipboard.writes === (related ? 0 : 1), '复制拒绝后仍输出内容')
      await remember(`${action}-${related ? 'related-rejected' : 'unrelated-saved'}`, { commits: action === 'copy' ? 0 : 1, undoRedo: !related && action !== 'copy', privateEvent: true })
    }
    await load(); const before = await read()
    await arm('write', true); await clipboard('cut'); await paused('write'); await release()
    await until(s => !s.clipboardBusy && Boolean(s.lastError), '私有写失败')
    check(commits().length === 0, '写剪贴板失败仍发送了删除'); assert.deepEqual(await read(), before)
    await remember('cut-private-write-failed', { commits: 0, originalRetained: true })

    for (const kind of ['image', 'video']) for (const replace of [false, true]) for (const mode of ['unrelated', 'upload-related', 'commit-related', 'lost-receipt']) {
      await load(kind)
      const beforeFiles = await files(), related = mode.endsWith('-related'), lost = mode === 'lost-receipt', stage = mode === 'upload-related' ? 'upload' : 'commit'
      await arm(stage, lost); await privateFile(kind, replace); await paused(stage)
      const id = related ? replace ? targetId : pageId : otherId
      const changes = related && !replace ? { name: `Changed page: ${mode}` } : { x: 456 }
      const prior = (await read()).snapshot.store[id]
      const changed = await remote([{ type: 'update', id, changes }])
      check(Object.keys(changes).some(key => prior[key] !== changed.snapshot.store[id][key]), '远端竞态必须实际改变目标字段')
      if (stage !== 'commit') await until(s => s.revision === changed.revision, '媒体准备期间远端广播')
      await release()
      const finished = await until(async s => !s.submitting && (related ? await evaluate("document.querySelector('#status').textContent.includes('变化')") : s.revision !== changed.revision) && (!lost || s.lastError?.message.includes('synthetic commit receipt lost')), '媒体完成')
      const saved = await read()
      const count = mode === 'upload-related' ? 0 : 1
      check(commits().length === count, '媒体修改请求重发或遗漏')
      const starts = requests.filter(request => request.body?.purpose === 'file-import-begin')
      check(starts.length === 1 && starts[0].body.recordBasis && starts[0].body.intent.type === 'media_import_target', '上传未携开始时条件')
      if (related) {
        assert.deepEqual(saved.snapshot, changed.snapshot)
        if (mode === 'upload-related') check(requests.filter(request => request.body?.dataUrl).length === 0, '相关变化后仍发出资源字节')
        else await until(async () => aborted() && (await files()).length === beforeFiles.length, '最终拒绝后的本次文件清理')
        assert.deepEqual(await files(), beforeFiles)
      } else {
        const records = kind === 'image' ? finished.imageRecords : finished.videoRecords
        assert.deepEqual(Object.fromEntries(records.map(r => [r.id, r])), Object.fromEntries(Object.values(saved.snapshot.store).filter(r => ['shape', 'asset'].includes(r.typeName)).map(r => [r.id, r])))
        check(saved.snapshot.store[otherId].x === 456, '媒体保存覆盖远端')
        if (replace) check(saved.snapshot.store[targetId].props.assetId !== changed.snapshot.store[targetId].props.assetId, '替换没有写入新资产')
        else check(Object.values(saved.snapshot.store).filter(r => r.typeName === 'shape').length === Object.values(changed.snapshot.store).filter(r => r.typeName === 'shape').length + 1, '插入没有恰好新增一个形状')
        if (lost) {
          await until(aborted, '丢回执后的凭证清理')
          check(requests.some(request => request.path === '/api/canvas'), '丢回执后没有只读刷新')
        }
        check((await files()).length === beforeFiles.length + 1, '保存资源被误清理或产生额外文件')
        const added = Object.values(saved.snapshot.store).find(r => r.typeName === 'asset' && !changed.snapshot.store[r.id])
        const asset = await fetch(new URL(added.props.src, origin))
        check(asset.status === 200, '保存后的资源不可读')
        assert.deepEqual(Buffer.from(await asset.arrayBuffer()), Buffer.from(kind === 'image' ? rasterFiles.png.base64 : videoData.mp4.split(',')[1], 'base64'))
        await history(changed, saved)
        check(commits().length === 1, '保存或丢回执后自动补发了修改')
      }
      await remember(`${kind}-${replace ? 'replace' : 'insert'}-${mode}`, { commits: count, uploadGuard: true, privateFile: true, undoRedo: !related, lostReceipt: lost, resourceFiles: (await files()).length })
    }
    return { samples, guards: probe.proof, native: probe.blocked, opens: probe.opens, systemClipboardUsed: false }
  } catch (error) {
    await writeFile(join(output, 'failure-state.json'), JSON.stringify({ message: error.message, samples, requests, state: await state(), gate: await evaluate(`${gate}?.inspect()`), native: probe.blocked, opens: probe.opens }, null, 2))
    throw error
  } finally { await release().catch(() => {}); wc.debugger.off('message', listener) }
}
