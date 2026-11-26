import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { startInteractionPreview } from './renderer-preview/service.mjs'

test('隔离服务跨运行时重建仍可撤销自己的上次拖动并重做；手势中拒绝且不发请求', async () => {
  // 干净检出（如 CI）里没有 .scratch，先建好再建临时目录。
  await mkdir(resolve('.scratch'), { recursive: true })
  const dir = await mkdtemp(resolve('.scratch/camera-service-'))
  let preview, session, interaction, count = 0, time = 0
  try {
    preview = await startInteractionPreview({ dataDir: dir })
    const metadata = await (await fetch(preview.url + '/__renderer_fixture?count=500')).json()
    const query = '?conversation=' + metadata.conversationId, actor = 'camera-reload'
    const request = async (path, body) => {
      const res = await fetch(preview.url + path + query, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1', 'x-hicanvas-actor': actor }, body: body && JSON.stringify(body) })
      const reply = await res.json(); assert.equal(res.status, 200, JSON.stringify(reply)); return reply
    }
    const transport = { read: () => request('/api/canvas'), subscribe: () => () => {},
      commit: ({ expectedRevision, commands }) => request('/__interaction/commit', { expectedRevision, commands }),
      undo: body => { count++; return request('/api/canvas/undo', body) }, redo: body => { count++; return request('/api/canvas/redo', body) },
    }
    const open = async () => { session = await createEditorSession({ actor, transport }); interaction = createCanvasInteraction({ session }) }
    const send = (type, extra) => interaction.dispatch({ type, time: time += 16, ...extra })
    const pointer = (type, x, y) => send('pointer_' + type, { point: { x, y }, pointerId: 1, button: 0 })
    await open()
    pointer('down', 40, 40); pointer('move', 80, 60)
    await assert.rejects(send('key_down', { key: 'z', metaKey: true }), /结束当前手势/)
    assert.equal(count, 0); assert.equal(session.state.get().isGestureActive, true)
    await pointer('up', 80, 60); assert.equal(session.store.get('shape:perf-0').x, 40)
    const saved = (await transport.read()).revision
    interaction.dispose(); session.dispose(); await open()
    assert.equal(session.store.get('shape:perf-0').x, 40)
    await send('key_down', { key: 'z', ctrlKey: true }); assert.equal(session.store.get('shape:perf-0').x, 0)
    await send('key_down', { key: 'z', metaKey: true, shiftKey: true }); assert.equal(session.store.get('shape:perf-0').x, 40)
    assert.notEqual((await transport.read()).revision, saved)
    assert.equal(count, 2)
    for (const path of ['/api/image/generate', '/api/canvas/operations']) assert.equal((await fetch(preview.url + path + query, { method: 'POST' })).status, 403)
    assert.equal((await fetch(preview.url + '/api/canvas/undo?conversation=not-provisioned', { method: 'POST' })).status, 404)
  } finally {
    try { interaction?.dispose(); session?.dispose() }
    finally { try { await preview?.close() } finally { await rm(dir, { recursive: true, force: true }) } }
  }
})
