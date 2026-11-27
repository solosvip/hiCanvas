import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startInteractionPreview } from './renderer-preview/service.mjs'
import { httpSessionTransport } from '../server/fixtures/editor-session-http-fixture.mjs'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'

test('隔离预览拒绝非 scratch 路径及正式端口', async () => {
  await assert.rejects(startInteractionPreview({ dataDir: '/tmp/not-own-scratch' }), /scratch/)
  await assert.rejects(startInteractionPreview({ port: 43218 }), /端口/)
})

test('真实隔离服务：一次拖动一次保存、刷新保持、提交只含拖动净变化，拒绝生图和旧快照写入口', async () => {
  const dir = await mkdtemp(resolve('.scratch/selection-service-')), preview = await startInteractionPreview({ dataDir: dir, watch: false })
  let session, interaction
  try {
    const metadata = await (await fetch(preview.url + '/__renderer_fixture?count=500')).json()
    const query = '?conversation=' + metadata.conversationId, actor = 'selection-service'
    async function request(path, body) {
      const response = await fetch(preview.url + path + query, { method: 'POST', headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', 'x-hicanvas-actor': actor }, body: JSON.stringify(body) })
      const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value
    }
    const transport = httpSessionTransport(preview.url, metadata.conversationId)
    const before = await transport.read(), commits = []
    const wrapped = { ...transport, commit: async body => { commits.push(body); return request('/__interaction/commit', { expectedRevision: body.expectedRevision, commands: body.commands }) } }
    session = await createEditorSession({ transport: wrapped, actor }); await transport.ready
    interaction = createCanvasInteraction({ session, camera: { x: 0, y: 0, z: 1 } })
    let time = 0
    const pointer = (type, x, y) => interaction.dispatch({ type: 'pointer_' + type, time: ++time, point: { x, y }, button: 0, pointerId: 1 })
    pointer('down', 40, 40); pointer('move', 80, 60); pointer('move', 90, 65); await pointer('up', 90, 65)
    assert.equal(commits.length, 1)
    const saved = await transport.read()
    assert.notEqual(saved.revision, before.revision)
    assert.equal(saved.snapshot.store['shape:perf-0'].x, 50)
    await session.refresh(); assert.equal(session.store.get('shape:perf-0').x, 50)
    assert.equal((await fetch(preview.url + '/api/image/generate' + query, { method: 'POST' })).status, 403)
    assert.equal((await fetch(preview.url + '/api/canvas' + query, { method: 'PUT' })).status, 403)
    assert.equal(commits[0].commands.length, 1)
    assert.equal(commits[0].commands[0].record.id, 'shape:perf-0')
    assert.deepEqual(commits[0].commands[0].record, saved.snapshot.store['shape:perf-0'])
    const denied = await fetch(preview.url + '/__interaction/commit' + query, { method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'http://example.com' }, body: '{}' })
    assert.equal(denied.status, 403)
  } finally { interaction?.dispose(); session?.dispose(); await preview.close(); await rm(dir, { recursive: true, force: true }) }
})
