import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './perf/fixture.mjs'
import { createRendererFixture, startRendererPreview } from './renderer-preview.mjs'
import { createGallery } from './renderer-preview/gallery.js'
import { attachPreviewInput } from './renderer-preview/input.js'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'

test('测量图鉴保留四档四线型、长边以及双色 lined-fill 和曲线对照样本', () => {
  for (const mode of ['metrics', 'metrics-long', 'metrics-curves']) {
    const fixture = createGallery(mode)
    const shapes = Object.values(fixture.snapshot.store).filter(record => record.typeName === 'shape')
    assert.equal(shapes.length, mode === 'metrics-curves' ? 10 : 22)
    for (const size of ['s', 'm', 'l', 'xl']) for (const dash of mode === 'metrics-curves' ? ['dashed', 'dotted'] : ['solid', 'dashed', 'dotted', 'draw']) {
      assert.equal(shapes.filter(record => record.props.size === size && record.props.dash === dash && record.props.fill === 'none').length >= 1, true)
    }
    if (mode === 'metrics-curves') assert.deepEqual(shapes.filter(record => record.props.fill === 'lined-fill').map(record => record.props.color), ['black', 'blue'])
  }
})

test('外壳把中键事件送交交互模块，视角以该会话为准，重置校验且不暴露可变引用', async () => {
  const host = new EventTarget(), fixture = createRendererFixture(500)
  const session = await createEditorSession({ transport: memoryTransport(fixture.snapshot), actor: 'shell' })
  const interaction = createCanvasInteraction({ session, camera: { x: 10, y: 20, z: 2 } })
  const errors = [], controls = attachPreviewInput(host, interaction, { onError: e => errors.push(e) })
  const pointer = (type, point) => host.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 1, ...point }))
  try {
    pointer('pointerdown', { clientX: 100, clientY: 200 })
    pointer('pointermove', { clientX: 180, clientY: 240 })
    assert.deepEqual(controls.getCamera(), { x: 50, y: 40, z: 2 })
    pointer('pointerup', { clientX: 180, clientY: 240 })
    pointer('pointermove', { clientX: 500, clientY: 600 })
    assert.deepEqual(controls.getCamera(), { x: 50, y: 40, z: 2 })
    const reset = { x: -3, y: 5, z: .25 }
    controls.resetCamera(reset); reset.x = 999
    const observed = controls.getCamera(); observed.x = 999
    assert.deepEqual(controls.getCamera(), { x: -3, y: 5, z: .25 })
    for (const invalid of [null, {}, { x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 1 }]) assert.throws(() => controls.resetCamera(invalid), /相机/)
    assert.deepEqual(errors, [])
  } finally { controls.dispose(); interaction.dispose(); session.dispose() }
})

test('三档合成规则完整保留 #36 几何类型、semi 填充、数量和相机', () => {
  for (const count of [500, 2000, 5000]) {
    const fixture = createRendererFixture(count), baseline = createFixture(count)
    assert.deepEqual(fixture.counts, baseline.counts)
    assert.deepEqual(fixture.viewState, baseline.viewState)
    assert.equal(Object.values(fixture.snapshot.store).filter(r => r.typeName === 'shape').length, count)
    for (const record of Object.values(fixture.snapshot.store)) {
      const before = baseline.snapshot.store[record.id]
      // Fractional indices include random jitter; only their relative order is
      // part of the fixture contract, not the exact generated strings.
      const comparable = record.typeName === 'shape' ? { ...record, index: before.index } : record
      assert.deepEqual(comparable, before)
    }
    const orderedIds = data => Object.values(data.snapshot.store).filter(r => r.typeName === 'shape').sort((a, b) => a.index < b.index ? -1 : 1).map(r => r.id)
    assert.deepEqual(orderedIds(fixture), orderedIds(baseline))
  }
})

test('独立预览只提供合成数据，拒绝写入与未知规模，不启动正式应用配置', async () => {
  const preview = await startRendererPreview()
  try {
    assert.match(await (await fetch(preview.url)).text(), /renderer-preview\/main.js|\.\/main.js/)
    const response = await fetch(`${preview.url}/__renderer_fixture?count=500`)
    assert.equal(response.status, 200)
    const solid = await response.json()
    assert.equal(solid.count, 500)
    const draw = await (await fetch(`${preview.url}/__renderer_fixture?count=500&dash=draw`)).json()
    const again = await (await fetch(`${preview.url}/__renderer_fixture?count=500`)).json()
    assert.deepEqual(again, solid)
    for (const record of Object.values(draw.snapshot.store)) {
      const before = solid.snapshot.store[record.id]
      const expected = record.typeName === 'shape' ? { ...before, index: record.index } : before
      if (record.typeName === 'shape' && record.type === 'geo') expected.props = { ...expected.props, dash: 'draw' }
      assert.deepEqual(record, expected)
    }
    assert.equal((await fetch(`${preview.url}/__renderer_fixture?count=500&dash=dotted`)).status, 400)
    assert.equal((await fetch(`${preview.url}/__renderer_fixture?count=500`, { method: 'POST' })).status, 405)
    assert.equal((await fetch(`${preview.url}/__renderer_fixture?count=123`)).status, 400)
  } finally { await preview.close() }
  await assert.rejects(startRendererPreview({ port: 43218 }), /端口/)
})
