import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'
import { createCanvasExport } from '../engine/index.js'

test('导出动作固定目标、背景只属于会话，空选回退整页而全部忽略选择', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo' }] })
  const output = [], saved = []
  const exp = createCanvasExport({ session: f.session, interaction: f.interaction, background: 'rgb(249,250,251)', render: async (snapshot, options) => {
    output.push({ snapshot, options }); return { status: 'complete', bytes: new Uint8Array([1]), mime: 'image/png' }
  }, download: async data => saved.push(data) })
  try {
    const before = f.current()
    await exp.run({ format: 'png' })
    assert.equal(output[0].options.ids, undefined)
    assert.equal(output[0].options.background, 'rgb(249,250,251)')
    f.interaction.select('all'); exp.setBackground(false)
    await exp.run({ format: 'svg' }); await exp.run({ scope: 'all', format: 'png' })
    assert.deepEqual(output[1].options.ids, ['shape:a']); assert.equal(output[1].options.background, null)
    assert.equal(output[2].options.ids, undefined); assert.equal(saved.length, 3)
    f.interaction.setInputContext({ owner: 'form' })
    assert.equal((await exp.run()).reason, 'input-owner')
    assert.equal((await exp.run({ origin: 'toolbar' })).status, 'complete')
    assert.equal(f.commits.length, 0); assert.deepEqual(f.current(), before)
  } finally { exp.dispose(); f.close() }
})

test('焦点在普通按钮、工具栏按钮、链接或收起的菜单按钮上时，导出照常可用（#209 与 #210 合并）', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo' }] })
  const exp = createCanvasExport({ session: f.session, interaction: f.interaction, background: '#ffffff', render: async () => ({ status: 'complete', bytes: new Uint8Array([1]), mime: 'image/png' }), download: async () => {} })
  try {
    for (const owner of ['button', 'toolbar-button', 'anchor', 'menu-trigger']) {
      f.interaction.setInputContext({ owner })
      assert.equal((await exp.run({ origin: 'toolbar' })).status, 'complete', owner)
      assert.equal((await exp.run()).status, 'complete', owner)
    }
    // An open menu, a native select and composition still keep the action away.
    f.interaction.setInputContext({ owner: 'menu-trigger', expanded: true })
    assert.equal((await exp.run({ origin: 'toolbar' })).reason, 'input-owner')
    f.interaction.setInputContext({ owner: 'select' })
    assert.equal((await exp.run({ origin: 'toolbar' })).reason, 'input-owner')
    assert.equal((await exp.run()).reason, 'input-owner')
    f.interaction.setInputContext({ owner: 'toolbar-button', isComposing: true })
    assert.equal((await exp.run({ origin: 'toolbar' })).reason, 'composing')
    assert.equal(f.commits.length, 0)
  } finally { exp.dispose(); f.close() }
})

test('导出期间固定快照与选择；重复动作、文字输入和手势不争用；销毁后不下载', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo' }] })
  let finish, received, writes = 0
  const exp = createCanvasExport({ session: f.session, interaction: f.interaction, background: '#ffffff', render: (snapshot, options) => {
    received = { snapshot, options }; return new Promise(resolve => { finish = resolve })
  }, download: () => { writes++ } })
  try {
    f.interaction.select('all')
    const pending = exp.run()
    assert.equal((await exp.run()).reason, 'exporting')
    await f.remote([{ type: 'create_shape', id: 'shape:remote', shapeType: 'geo' }])
    f.interaction.select('clear')
    assert.equal(received.snapshot.store['shape:remote'], undefined)
    assert.deepEqual(received.options.ids, ['shape:a'])
    exp.dispose(); finish({ status: 'complete', bytes: new Uint8Array([1]), mime: 'image/png' })
    assert.equal((await pending).status, 'cancelled'); assert.equal(writes, 0)
    assert.equal((await exp.run()).reason, 'disposed'); assert.equal(f.commits.length, 0)
  } finally { exp.dispose(); f.close() }
})

test('渲染与下载失败不写事务，空画板不调用下载，忙状态在失败后释放', async () => {
  const f = await creationFixture(), before = f.current()
  let mode = 'empty', downloads = 0
  const exp = createCanvasExport({ session: f.session, interaction: f.interaction, background: '#fff', render: async () => {
    if (mode === 'fail') throw Object.assign(new Error('Synthetic capture failed'), { blockedResources: 2 })
    return mode === 'empty' ? { status: 'empty' } : { status: 'complete', bytes: new Uint8Array([1]) }
  }, download: () => { downloads++; throw new Error('Synthetic download refused') } })
  try {
    assert.equal((await exp.run()).status, 'empty'); assert.equal(downloads, 0)
    mode = 'fail'; await assert.rejects(exp.run(), /capture failed/)
    assert.equal(exp.state.get().busy, false); assert.equal(exp.state.get().lastError.blockedResources, 2)
    mode = 'complete'; await assert.rejects(exp.run(), /download refused/)
    assert.equal(exp.state.get().busy, false)
    f.session.beginGesture(); assert.equal((await exp.run()).reason, 'pointer-gesture'); f.session.cancelGesture()
    f.interaction.setInputContext({ owner: 'text-editing' }); assert.equal((await exp.run()).reason, 'text-editing')
    assert.deepEqual(f.current(), before); assert.equal(f.commits.length, 0)
  } finally { exp.dispose(); f.close() }
})

test('共用生命周期保留取消信号与下载边界，普通输出不受另一控制器取消影响', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo' }] })
  let release, writes = 0
  const options = { session: f.session, interaction: f.interaction, background: '#fff', download: (_result, { filename, signal }) => { signal.throwIfAborted(); assert.equal(filename, 'hiCanvas.png'); writes++ } }
  const a = createCanvasExport({ ...options, render: () => new Promise(resolve => { release = resolve }) })
  const b = createCanvasExport({ ...options, render: async () => ({ status: 'complete', bytes: new Uint8Array([1]) }) })
  try {
    const controller = new AbortController(), pending = a.run({ signal: controller.signal })
    controller.abort(new Error('Synthetic cancellation'))
    await b.run(); assert.equal(writes, 1)
    release({ status: 'complete', bytes: new Uint8Array([1]) })
    assert.equal((await pending).status, 'cancelled'); assert.equal(writes, 1)
    assert.equal(a.state.get().busy, false); assert.equal(f.commits.length, 0)
  } finally { a.dispose(); b.dispose(); f.close() }
})
