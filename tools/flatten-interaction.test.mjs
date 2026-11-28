import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

const commands = [{ type: 'create_shape', id: 'shape:source', shapeType: 'geo', x: 20, y: 30 }]
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function setup(t, { renderGate, uploadGate, ...options } = {}) {
  let uploads = 0, cleanups = 0, renders = 0
  const reached = deferred(), rendered = deferred()
  const bounds = { x: 19, y: 29, w: 202, h: 122 }
  const image = { src: '/c/11111111-1111-4111-8111-111111111111/assets/synthetic-media-import-flat.png', w: 404, h: 244, mimeType: 'image/png', isAnimated: false }
  const port = { format: 'png',
    preflight: () => ({ status: 'ready', bounds, width: 404, height: 244, scale: 2 }),
    render: async () => { renders++; rendered.resolve(); await renderGate?.promise; return { status: 'complete', bounds, width: 404, height: 244, scale: 2, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) } },
    begin: () => ({ upload: async () => { uploads++; reached.resolve(); await uploadGate?.promise; return { ...image } }, abort: async () => { cleanups++; return { remaining: 0 } } }),
    ...options.port,
  }
  const f = await creationFixture({ commands, ...options, flatten: port })
  f.interaction.select('all')
  t.after(() => f.close())
  return { ...f, image, reached: reached.promise, rendered: rendered.promise, uploads: () => uploads, cleanups: () => cleanups, renders: () => renders }
}

test('Shift+F复用公开动作：一次上传、一次提交，选择新图片且可撤销', async t => {
  const f = await setup(t)
  assert.equal(f.interaction.getFlatten().status, 'ready')
  await f.key('F', { shiftKey: true })
  assert.equal(f.commits.length, 1); assert.equal(f.uploads(), 1)
  assert.equal(f.commits[0].commands[0].type, 'flatten_shapes')
  assert.equal(f.shapes().length, 1); assert.equal(f.shapes()[0].type, 'image')
  assert.deepEqual(f.interaction.state.get().selectedIds, [f.shapes()[0].id])
  await f.session.undo(); assert.deepEqual(f.current().store, f.initial.store)
})

for (const cancel of ['escape', 'selection', 'tool', 'signal', 'timeout', 'dispose']) test(`上传等待中${cancel}取消，双触发不重复上传，源项和历史不变`, async t => {
  const timed = new AbortController(), originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  if (cancel === 'timeout') t.mock.method(AbortSignal, 'timeout', ms => ms === 60000 ? timed.signal : originalTimeout(ms))
  const gate = deferred(), f = await setup(t, { uploadGate: gate }), controller = new AbortController()
  const before = structuredClone(f.current()), pending = f.interaction.flatten({ type: 'start', signal: controller.signal })
  await f.reached
  assert.equal((await f.interaction.flatten({ type: 'start' })).status, 'unavailable')
  if (cancel === 'escape') f.key('Escape')
  if (cancel === 'selection') f.interaction.select('clear')
  if (cancel === 'tool') f.interaction.setTool('hand')
  if (cancel === 'signal') controller.abort()
  if (cancel === 'timeout') timed.abort()
  if (cancel === 'dispose') f.interaction.dispose()
  gate.resolve()
  assert.equal((await pending).status, 'cancelled')
  assert.equal(f.commits.length, 0); assert.equal(f.uploads(), 1); assert.equal(f.cleanups(), 1)
  assert.deepEqual(f.current(), before)
})

test('准备期间目标被锁或版本变化整次拒绝，坏回执也不提交', async t => {
  for (const mode of ['lock', 'version', 'bad-receipt']) {
    const gate = deferred(), f = await setup(t, { uploadGate: gate, ...(mode === 'bad-receipt' ? { port: { begin: () => ({ upload: async () => ({ src: 'https://external.invalid/a.png' }), abort: async () => ({ remaining: 0 }) }) } } : {}) })
    const pending = f.interaction.flatten({ type: 'start' })
    if (mode === 'bad-receipt') { await assert.rejects(pending, /回执/); continue }
    await f.reached
    await f.remote(mode === 'lock' ? [{ type: 'toggle_lock', ids: ['shape:source'] }] : [{ type: 'create_shape', id: 'shape:remote', shapeType: 'geo' }])
    gate.resolve(); await assert.rejects(pending, /变化|锁定/)
    assert.equal(f.commits.length, 0); assert.ok(f.current().store['shape:source'])
  }
})

for (const late of ['signal', 'timeout', 'dispose']) test(`提交发出后迟到${late}不能声称回滚，也不重发`, async t => {
  const timed = new AbortController(), originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  if (late === 'timeout') t.mock.method(AbortSignal, 'timeout', ms => ms === 60000 ? timed.signal : originalTimeout(ms))
  const entered = deferred(), gate = deferred(), f = await setup(t, { beforeCommit: async () => { entered.resolve(); await gate.promise } })
  const controller = new AbortController(), pending = f.interaction.flatten({ type: 'start', signal: controller.signal })
  await entered.promise
  if (late === 'signal') controller.abort()
  if (late === 'timeout') timed.abort()
  assert.equal(f.interaction.flatten({ type: 'cancel' }), false)
  if (late === 'dispose') f.interaction.dispose(); else f.interaction.setTool('hand')
  gate.resolve()
  assert.equal((await pending).status, 'complete'); assert.equal(f.commits.length, 1)
  assert.equal(f.shapes()[0].type, 'image')
})

test('输入框、重复按键和其他修饰键不触发扁平化，孤立图片不操作', async t => {
  const f = await setup(t)
  f.interaction.setInputContext({ owner: 'form' })
  await f.key('F', { shiftKey: true }); assert.equal(f.renders(), 0)
  assert.equal((await f.interaction.flatten({ type: 'start' })).status, 'unavailable')
  f.interaction.setInputContext({ owner: 'canvas' })
  await f.key('F', { shiftKey: true, repeat: true }); await f.key('F', { shiftKey: true, altKey: true })
  assert.equal(f.renders(), 0)
  await f.interaction.flatten({ type: 'start' })
  assert.equal(f.interaction.getFlatten().reason, 'already-image')
})

test('清理失败提示不被原上传错误覆盖，原错误仍可读且忙状态释放', async t => {
  const f = await setup(t, { port: { begin: () => ({ upload: async () => { throw new Error('合成原上传错误') }, abort: async () => { throw new Error('合成清理失败') } }) } })
  await assert.rejects(f.interaction.flatten({ type: 'start' }), /原上传错误.*未完全清理/)
  assert.match(f.interaction.state.get().lastError.message, /原上传错误.*未完全清理/)
  assert.equal(f.interaction.state.get().flattenStatus.phase, 'idle')
  assert.equal(f.interaction.getFlatten().status, 'ready')
  assert.equal(f.commits.length, 0)
})
