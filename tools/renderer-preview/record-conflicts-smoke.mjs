import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { externalSamples } from './external-samples.js'
import assert from 'node:assert/strict'

const check = (value, message) => { if (!value) throw new Error(message) }

// Shared native deny guards are installed before the first offscreen window.
export async function prepareRecordConflictsProbe(context) {
  const { prepareShapeLinksProbe } = await import('./shape-links-smoke.mjs')
  return prepareShapeLinksProbe(context)
}

export async function recordConflictsSmoke(window, output, probe, origin) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const mod = process.platform === 'darwin' ? 'meta' : 'control', requests = [], samples = []
  const sampleUrl = externalSamples.find(sample => sample.id === 'G13' && sample.kind === 'base').input
  const fakeEmbed = `${origin}/tools/renderer-preview/fake-embed.html?service=G13`
  const assertNavigation = () => check(probe.opens.every(item => item.kind === 'will-redirect' && item.url === fakeEmbed), '确认流程触发了非夹具导航')
  const fixture = await (await fetch(`${origin}/__renderer_fixture?gallery=image-import`)).json()
  check(fixture.persistent && fixture.conversationId, '专项必须使用隔离持久化夹具')
  const query = `?conversation=${encodeURIComponent(fixture.conversationId)}`
  async function read() {
    const response = await fetch(`${origin}/api/canvas${query}`, { headers: { 'x-hicanvas-client': '1' } })
    const value = await response.json(); check(response.ok, `读取合成快照失败：${response.status} ${JSON.stringify(value)}`); return value
  }
  async function remote(commands) {
    const before = await read(), response = await fetch(`${origin}/__interaction/commit${query}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1', 'x-hicanvas-actor': 'remote:231' },
      body: JSON.stringify({ expectedRevision: before.revision, commands }),
    })
    const result = await response.json(); check(response.ok, JSON.stringify(result)); return result
  }
  const pageId = Object.values((await read()).snapshot.store).find(record => record.typeName === 'page').id
  const otherId = 'shape:record-conflicts-other'
  await remote([{ type: 'create_shape', id: otherId, shapeType: 'geo', x: 1000, y: 600 }])
  const listener = (_event, method, params) => {
    if (method === 'Network.requestWillBeSent' && params.request.method === 'POST' && params.request.url.startsWith(`${origin}/__interaction/commit?`)) requests.push(JSON.parse(params.request.postData))
  }
  wc.debugger.on('message', listener); await wc.debugger.sendCommand('Network.enable')
  async function until(predicate, label) {
    const end = Date.now() + 15000
    while (Date.now() < end) {
      const s = await state(); if (s?.error) throw new Error(s.error)
      if (s && await predicate(s)) return s
      await delay(20)
    }
    throw new Error(`${label}超时：${JSON.stringify(await state()).slice(0, 1200)}`)
  }
  async function key(keyCode, modifiers = []) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); await flush()
    if (keyCode === 'Enter' && !await evaluate('Boolean(window.__shapeLinkLastKey?.defaultPrevented)')) { wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers }); await flush() }
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await flush()
  }
  async function click(selector) {
    const p = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.hidden)throw Error('控件不可用：'+${JSON.stringify(selector)});const r=n.getBoundingClientRect();if(!r.width||!r.height)throw Error('控件不可见');return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 })
    await flush()
  }
  async function selectImage() {
    const p = await evaluate(`(()=>{const r=document.querySelector('#canvas').getBoundingClientRect();return{x:Math.round(r.x+220),y:Math.round(r.y+210)}})()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 })
    await until(s => s.selectedIds.length === 1 && s.selectedIds[0] === 'shape:image-0', '图片选择')
  }
  async function type(selector, text) {
    await click(selector); await key('Home'); await key('End', ['shift']); await key('Backspace')
    const cleared = await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
    check(cleared === '', `原生输入未清空：${selector} ${cleared}`)
    await wc.insertText(text); await flush()
    const value = await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
    check(value === text, `原生输入读回不符：${selector} ${value}`)
  }
  async function reload() {
    await remote([
      { type: 'update', id: 'shape:image-0', changes: { x: 100, y: 120, props: { altText: '原有合成描述', url: '' } } },
      { type: 'update', id: otherId, changes: { x: 1000 } },
    ])
    await window.loadURL(`${origin}/?gallery=image-import&edgeScrolling=0&reduceMotion=1`)
    await until(s => s.ready && s.imageRecords, '持久化图片夹具')
    await evaluate("document.querySelector('#canvas').focus();void 0"); requests.length = 0
  }
  const record = (snapshot, id) => snapshot.store[id]
  try {
    for (const kind of ['alt', 'link', 'embed']) for (const related of [false, true]) {
      await reload()
      const before = await read(), oldIds = new Set(Object.keys(before.snapshot.store)), text = `确认231-${kind}`
      if (kind !== 'embed') await selectImage()
      if (kind === 'alt') { await click('[data-image-action=edit-alt]'); await type('[data-image-action=alt-text]', text) }
      if (kind === 'link') { await click('[data-shape-link-action=open]'); await type('[data-shape-link-action=url]', 'example.invalid/confirmed231') }
      if (kind === 'embed') { await key('I', [mod]); await until(s => s.embedEditing, '嵌入弹窗'); await click('[data-embed-action=service-G13]'); await type('[data-embed-action=url]', sampleUrl) }
      const changed = await remote([{ type: 'update', id: related ? kind === 'embed' ? pageId : 'shape:image-0' : otherId, changes: related && kind === 'embed' ? { name: `远端页面${Date.now()}` } : { x: related ? 108 : 456 } }])
      await until(s => s.revision === changed.revision, '远端广播')
      if (kind === 'alt') await key('Enter')
      else await click(kind === 'link' ? '[data-shape-link-action=submit]' : '[data-embed-action=submit]')
      const finished = await until(async s => !s.submitting && (related ? await evaluate("document.querySelector('#status').textContent.includes('目标或相关记录已变化')") : s.revision !== changed.revision), '确认结果')
      const saved = await read()
      let insertedId
      if (related) {
        check(saved.revision === changed.revision && requests.length === 0, '相关变化必须在发送前拒绝，不能改快照或历史')
        check(kind === 'alt' ? finished.imageAltEditing?.text === text : kind === 'link' ? finished.linkEditing?.url === 'example.invalid/confirmed231' : finished.embedEditing?.url === sampleUrl, '冲突后草稿丢失')
        const selector = kind === 'alt' ? '[data-image-action=alt-text]' : kind === 'link' ? '[data-shape-link-action=url]' : '[data-embed-action=url]'
        check(await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n.getBoundingClientRect().width>0&&n.value===${JSON.stringify(kind === 'alt' ? text : kind === 'link' ? 'example.invalid/confirmed231' : sampleUrl)}})()`), '冲突后输入框没有保留可见草稿')
      } else {
        check(requests.length === 1 && requests[0].recordBasis && requests[0].expectedRevision === changed.revision, '无关变化后应携当前确认版本和记录条件只发送一次')
        check(record(saved.snapshot, otherId).x === 456, '本地确认覆盖了远端记录')
        if (kind === 'alt') check(record(saved.snapshot, 'shape:image-0').props.altText === text, '描述未保存')
        if (kind === 'link') check(record(saved.snapshot, 'shape:image-0').props.url === 'https://example.invalid/confirmed231', '链接未保存')
        if (kind === 'embed') { insertedId = Object.keys(saved.snapshot.store).find(id => !oldIds.has(id) && saved.snapshot.store[id].type === 'embed'); check(insertedId, '嵌入没有落盘') }
        assert.deepEqual(Object.fromEntries(finished.imageRecords.map(r => [r.id, r])), Object.fromEntries(Object.values(saved.snapshot.store).filter(r => ['shape', 'asset'].includes(r.typeName)).map(r => [r.id, r])), '窗口未显示实际保存的快照')
        await evaluate("document.querySelector('#canvas').focus();void 0"); await key('Z', [mod])
        const undone = await until(s => s.revision !== saved.revision && !s.submitting, '本人撤销'), undoSaved = await read()
        check(record(undoSaved.snapshot, otherId).x === 456, '撤销抹掉远端变更')
        check(kind === 'alt' ? record(undoSaved.snapshot, 'shape:image-0').props.altText === '原有合成描述' : kind === 'link' ? record(undoSaved.snapshot, 'shape:image-0').props.url === '' : !record(undoSaved.snapshot, insertedId), '撤销没有恢复本人的改动')
        await key('Z', [mod, 'shift']); await until(s => s.revision !== undone.revision && !s.submitting, '本人重做')
        const redone = await read(); assert.deepEqual(redone.snapshot, saved.snapshot, '重做没有恢复实际保存快照')
      }
      const label = `${kind}-${related ? 'related-rejected' : 'unrelated-saved'}`
      const boundary = await evaluate('({clipboard:window.__embedClipboardViolations,blocked:window.__shapeLinkAudit.blocked,opens:window.__shapeLinkAudit.opens})')
      check(Object.values(boundary).every(value => value.length === 0), `${label}触发系统或导航边界`)
      assertNavigation()
      await writeFile(join(output, `${label}.png`), (await wc.capturePage()).toPNG())
      samples.push({ label, requests: requests.length, draftRetained: related, undoRedo: !related, revision: saved.revision, boundary, status: await evaluate("document.querySelector('#status').textContent") })
      await writeFile(join(output, 'stages.json'), JSON.stringify({ guards: probe.proof, samples }, null, 2))
      if (insertedId) await remote([{ type: 'delete', ids: [insertedId] }])
    }
    // The host rewrites the two G13 frame loads (create/redo) to this local
    // fake page; the shared deny guard still blocks both redirects. Retain them.
    assertNavigation(); check(probe.opens.length === 2, '嵌入创建和重做的两次本机框架重定向记录不符')
    const boundary = await evaluate('({clipboard:window.__embedClipboardViolations,blocked:window.__shapeLinkAudit.blocked,opens:window.__shapeLinkAudit.opens})')
    check(Object.values(boundary).every(value => value.length === 0), '确认流程触发系统或导航边界')
    return { samples, guards: probe.proof, native: probe.blocked, deniedFixtureRedirects: probe.opens, boundary }
  } catch (error) {
    await writeFile(join(output, 'failure-state.json'), JSON.stringify({ message: error.message, samples, requests, state: await state(), native: probe.blocked, opens: probe.opens }, null, 2))
    throw error
  } finally { wc.debugger.off('message', listener) }
}
