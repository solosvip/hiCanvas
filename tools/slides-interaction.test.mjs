import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createContext, runInContext } from 'node:vm'
import { launchSlidesBrowser } from './renderer-preview/slides-check.mjs'
import { prepareSlidesProbe } from './renderer-preview/slides-smoke.mjs'
import { creationFixture } from './creation-test-fixture.mjs'

const deck = { type: 'create_shape', id: 'shape:d', shapeType: 'frame', x: 50, y: 100, props: { w: 1048, h: 600 }, meta: { cowartAiSlides: true } }
const page = (id, x, w = 240, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'image', parentId: 'shape:d', x, y: 12, props: { w, h: 140 }, ...extra })
const commands = () => [deck, page('a', 12), page('b', 400, 360), page('c', 850, 180)]

test('同父级拖页保持自由预览，松手排序与框尺寸一次保存，一次撤销恢复整套', async () => {
  const f = await creationFixture({ commands: commands() })
  try {
    f.pointer('down', 100, 150); f.pointer('move', 800, 150)
    assert.equal(f.session.store.get('shape:a').x, 712)
    assert.equal(f.session.store.get('shape:b').x, 284, '预览不挪同套其他页')
    await f.pointer('up', 800, 150)
    assert.equal(f.commits.length, 1)
    assert.deepEqual(['b', 'c', 'a'].map(id => f.current().store[`shape:${id}`].x), [12, 404, 616])
    const after = f.current()
    await f.session.undo(); assert.deepEqual(f.current(), f.initial)
    await f.session.redo(); assert.deepEqual(f.current(), after)
  } finally { f.close() }
})

test('同套页拖走再回原位，松手不写空事务', async () => {
  const f = await creationFixture({ commands: commands() })
  try {
    f.pointer('down', 100, 150); f.pointer('move', 800, 150); f.pointer('move', 100, 150)
    await f.pointer('up', 100, 150)
    assert.equal(f.commits.length, 0)
    assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

for (const change of ['peer', 'membership']) test(`同父级拖页也保护 Slides ${change} 依赖，不重放覆盖远端`, async () => {
  const f = await creationFixture({ commands: commands() })
  try {
    f.pointer('down', 100, 150); f.pointer('move', 800, 150)
    await f.remote(change === 'peer' ? [{ type: 'update', id: 'shape:b', changes: { meta: { remote: true } } }] : [page('new', 1200, 100)], false)
    const remote = f.current()
    await assert.rejects(f.pointer('up', 800, 150), e => e.code === 'conflict')
    assert.deepEqual(f.current(), remote)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})


test('清单写入挂起时取消，不再创建 Electron 进程并完成释放', async () => {
  const cancellation = new AbortController()
  let finishWrite, started = 0, released = false
  const pending = launchSlidesBrowser({ manifest: 'synthetic.json', data: '{}', signal: cancellation.signal,
    writeManifest: () => new Promise(resolve => { finishWrite = resolve }), launch: () => { started++; return 0 },
  }).finally(() => { released = true })
  cancellation.abort(new Error('synthetic cancellation'))
  finishWrite()
  await assert.rejects(pending, /synthetic cancellation/)
  assert.equal(started, 0)
  assert.equal(released, true)
})

test('早期被捕获的系统能力拒绝跨导航保留，不被最终空记录掩盖', async () => {
  // Browser/OS stand-ins are external boundaries; the real guard code runs in
  // fresh JS contexts for each document, exactly as navigation would replace it.
  const debuggerApi = new EventEmitter()
  let context, documentScript, rawReads = 0
  const makeDocument = () => {
    context = createContext({})
    runInContext('window=globalThis;class Navigator{};navigator=new Navigator();class Document{execCommand(){}};class HTMLInputElement{click(){}}', context)
    context.__slidesViolation = payload => debuggerApi.emit('message', {}, 'Runtime.bindingCalled', { name: '__slidesViolation', payload })
    if (documentScript) runInContext(documentScript, context)
  }
  debuggerApi.attach = () => {}
  debuggerApi.sendCommand = async (method, args) => { if (method === 'Page.addScriptToEvaluateOnNewDocument') documentScript = args.source }
  const contents = { debugger: debuggerApi, setWindowOpenHandler() {}, executeJavaScript: async code => runInContext(code, context) }
  const target = { webContents: contents, loadURL: async () => makeDocument() }
  const clipboard = { readText() { rawReads++; return 'never read' } }
  const guard = await prepareSlidesProbe(target, clipboard)
  await target.loadURL('synthetic:first')
  await contents.executeJavaScript('try{navigator.clipboard.readText()}catch{}')
  await target.loadURL('synthetic:second')
  assert.equal((await contents.executeJavaScript('window.__slidesDenied')).length, 0)
  assert.deepEqual(guard.calls, ['browser.clipboard'], '最终门禁必须仍看见前一页的拒绝')
  assert.equal(rawReads, 0)
})
