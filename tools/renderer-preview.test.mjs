import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './perf/fixture.mjs'
import { createRendererFixture, startRendererPreview } from './renderer-preview.mjs'

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
