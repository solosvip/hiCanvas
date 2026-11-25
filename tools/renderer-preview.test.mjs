import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './perf/fixture.mjs'
import { createRendererFixture, startRendererPreview } from './renderer-preview.mjs'
import { attachPreviewInput } from './renderer-preview/input.js'

test('中键拖动按缩放换算视角位移，松开停止；重置视角验证参数且不暴露可变引用', () => {
  const host = new EventTarget()
  let camera = { x: 10, y: 20, z: 2 }
  const controls = attachPreviewInput(host, { getCamera: () => ({ ...camera }), setCamera: value => { camera = { ...value } } })
  const pointer = (type, point) => host.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 1, ...point }))
  pointer('pointerdown', { clientX: 100, clientY: 200 })
  pointer('pointermove', { clientX: 180, clientY: 240 })
  assert.deepEqual(camera, { x: 50, y: 40, z: 2 })
  pointer('pointerup', { clientX: 180, clientY: 240 })
  pointer('pointermove', { clientX: 500, clientY: 600 })
  assert.deepEqual(camera, { x: 50, y: 40, z: 2 })
  const reset = { x: -3, y: 5, z: .25 }
  controls.resetCamera(reset); reset.x = 999
  assert.deepEqual(camera, { x: -3, y: 5, z: .25 })
  const observed = controls.getCamera()
  assert.deepEqual(observed, camera)
  observed.x = 999
  assert.deepEqual(controls.getCamera(), { x: -3, y: 5, z: .25 })
  for (const invalid of [null, {}, { x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 1 }, { x: 0, y: Infinity, z: 1 }]) assert.throws(() => controls.resetCamera(invalid), /视角/)
  assert.deepEqual(camera, { x: -3, y: 5, z: .25 })
  controls.dispose()
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
    assert.equal((await response.json()).count, 500)
    assert.equal((await fetch(`${preview.url}/__renderer_fixture?count=500`, { method: 'POST' })).status, 405)
    assert.equal((await fetch(`${preview.url}/__renderer_fixture?count=123`)).status, 400)
  } finally { await preview.close() }
  await assert.rejects(startRendererPreview({ port: 43218 }), /端口/)
})
