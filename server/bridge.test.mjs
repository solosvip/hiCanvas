import '../tools/test-sandbox.mjs'
import test from 'node:test'
import { executeCanvasCommands } from '../engine/index.js'
import { applyCanvasOperations } from './canvas-operations.mjs'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHiCanvasMcp } from '../mcp/server.mjs'
import { fixture } from './test-helpers.mjs'
import { readFile } from 'node:fs/promises'

async function agent(t, baseUrl) {
  const [a, b] = InMemoryTransport.createLinkedPair()
  const server = createHiCanvasMcp({ baseUrl, open: async () => {}, receiver: null })
  const client = new Client({ name: 'canvas-bridge-agent', version: '1' })
  await server.connect(b)
  await client.connect(a)
  t.after(async () => { await client.close(); await server.close() })
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result))
    return result.structuredContent
  }
  const opened = await call('open_conversation')
  return { call, client, id: opened.conversationId, revision: opened.revision }
}

test('通用 MCP 将 HTML 和影片原位替换到原版占位框，Slides 页面仍属于同一套演示', async t => {
  const { base } = await fixture(t)
  const { call, client, id, revision } = await agent(t, base)
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'insert_cowart_html_draft'), 'MCP 应暴露原版 HTML/影片/Slides 写回能力')
  const state = await call('get_canvas', { conversationId: id })
  const pageId = Object.values(state.snapshot.store).find(r => r.typeName === 'page').id
  const created = await call('apply_canvas_operations', { conversationId: id, expectedRevision: revision, operations: [
    { type: 'create_shape', id: 'shape:html', shapeType: 'frame', x: 100, y: 200, rotation: 0.2, props: { w: 900, h: 600 }, meta: { cowartAiDraftHolder: true } },
    { type: 'create_shape', id: 'shape:film', shapeType: 'frame', x: 1200, y: 200, meta: { cowartAiDraftHolder: true, cowartAiFilmHolder: true, cowartFilmDuration: 5 } },
    { type: 'create_shape', id: 'shape:slides', shapeType: 'frame', meta: { cowartAiSlides: true } }
  ] })
  const html = await call('insert_cowart_html_draft', { conversationId: id, expectedRevision: created.revision, draftShapeId: 'shape:html', htmlContent: '<!doctype html><html><body>中文原型</body></html>' })
  assert.equal(html.replacedAiDraftHolder, true)
  assert.deepEqual([html.shapeRecord.x, html.shapeRecord.y, html.shapeRecord.rotation, html.shapeRecord.props.w, html.shapeRecord.props.h], [100, 200, 0.2, 900, 600])
  const film = await call('insert_cowart_html_draft', { conversationId: id, expectedRevision: html.revision, draftShapeId: 'shape:film', htmlContent: '<html><body>影片</body></html>' })
  assert.equal(film.shapeRecord.meta.cowartFilm, true)
  assert.equal(film.shapeRecord.meta.cowartFilmDuration, 5)
  let latest = film
  for (let i = 1; i <= 3; i++) latest = await call('insert_cowart_html_draft', { conversationId: id, expectedRevision: latest.revision, draftShapeId: 'shape:slides', htmlContent: `<html><body>第${i}页</body></html>`, shapeMeta: { cowartAiSlidesGeneratedPage: i } })
  const final = await call('get_canvas', { conversationId: id })
  assert.equal(final.snapshot.store['shape:html'], undefined)
  const pages = Object.values(final.snapshot.store).filter(r => r.parentId === 'shape:slides')
  assert.equal(pages.length, 3)
  assert.deepEqual(pages.map(r => r.y), [12, 12, 12])
  assert.equal(new Set(pages.map(r => r.x)).size, 3)
  const response = await fetch(base + html.assetUrl)
  assert.equal(await response.text(), '<!doctype html><html><body>中文原型</body></html>')
})

test('独立画板可保存 DOM 修改并将整套 Slides 导出同一目录，拒绝跨目录文件名', async t => {
  const { api, base } = await fixture(t)
  const { call, id, revision } = await agent(t, base)
  const inserted = await call('insert_cowart_html_draft', { conversationId: id, expectedRevision: revision, htmlContent: '<html><body>初稿</body></html>' })
  const edited = await api(`/api/html-draft?conversation=${id}`, 'PUT', { expectedRevision: inserted.revision, draftShapeId: inserted.shapeId, htmlContent: '<html><body>文字已编辑</body></html>' })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.shapeId, inserted.shapeId)
  assert.equal(edited.body.contentHash, edited.body.shapeRecord.meta.cowartHtmlDraftContentHash, 'DOM 编辑响应必须给前端返回新内容指纹，避免下一次自动保存回退指纹')
  assert.notEqual(edited.body.shapeRecord.meta.cowartHtmlDraftContentHash, inserted.shapeRecord.meta.cowartHtmlDraftContentHash)
  assert.equal(await (await fetch(base + edited.body.assetUrl)).text(), '<html><body>文字已编辑</body></html>')
  const output = await api(`/api/exports/file?conversation=${id}`, 'POST', { directoryName: '合成演示', uniqueDirectory: true, subdirectory: 'pages', fileName: 'page-01.html', dataUrl: 'data:text/html;base64,' + Buffer.from('<h1>页面</h1>').toString('base64') })
  assert.equal(output.status, 200)
  const player = await api(`/api/exports/file?conversation=${id}`, 'POST', { directoryName: output.body.directoryName, fileName: 'Play.html', dataUrl: 'data:text/html,%E6%BC%94%E7%A4%BA' })
  assert.equal(player.body.directoryPath, output.body.directoryPath)
  assert.equal(await readFile(output.body.filePath, 'utf8'), '<h1>页面</h1>')
  assert.equal(await readFile(player.body.filePath, 'utf8'), '演示')
  assert.equal((await api(`/api/exports/file?conversation=${id}`, 'POST', { directoryName: '../outside', dataUrl: 'data:text/plain,x' })).status, 400)
})

test('画板按钮创建持久请求，绑定 Agent 经 MCP 获取并完成；另一个对话不收到请求', async t => {
  const { api, base } = await fixture(t)
  const { call, id } = await agent(t, base)
  const other = await call('open_conversation', { createNew: true })
  const submitted = await api(`/api/agent/requests?conversation=${id}`, 'POST', { prompt: '生成 HTML 原型', content: [{ type: 'text', text: '生成 HTML 原型' }], context: { promptType: 'ai_html', targetShapeId: 'shape:target' } })
  assert.equal(submitted.status, 202)
  const pending = await call('get_canvas_requests', { conversationId: id })
  assert.equal(pending.requests.length, 1)
  assert.equal(pending.requests[0].prompt, '生成 HTML 原型')
  assert.equal((await call('get_canvas_requests', { conversationId: other.conversationId })).requests.length, 0)
  await call('complete_canvas_request', { conversationId: id, requestId: submitted.body.request.id, status: 'completed' })
  assert.equal((await call('get_canvas_requests', { conversationId: id })).requests.length, 0)
})


test('占位框内大小写索引的背景和文字迁移后保持原先层次', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const { snapshot } = await workspace.read(id)
  applyCanvasOperations(snapshot, [
    { type: 'create_shape', id: 'shape:holder', shapeType: 'frame', meta: { cowartAiDraftHolder: true } },
    { type: 'create_shape', id: 'shape:background', shapeType: 'geo', parentId: 'shape:holder' },
    { type: 'create_shape', id: 'shape:label', shapeType: 'text', parentId: 'shape:holder', text: '在背景上方' }
  ])
  snapshot.store['shape:background'].index = 'a1A'
  snapshot.store['shape:label'].index = 'a1a'
  const edited = executeCanvasCommands(snapshot, [{ type: 'insert_html', args: { draftShapeId: 'shape:holder' }, html: { url: 'data:text/html,<h1>合成</h1>', assetUrl: '', contentHash: 'synthetic' } }])
  const result = edited.results[0], records = edited.snapshot.store
  assert.ok(records[result.shapeId].index < records['shape:background'].index)
  assert.ok(records['shape:background'].index < records['shape:label'].index, '文字必须继续位于背景上方')
})

test('MCP 放图继续返回原字段，并可复用当前画板的已保存图片', async t => {
  const { base } = await fixture(t)
  const { call, id, revision } = await agent(t, base)
  const first = await call('insert_cowart_image', { conversationId: id, expectedRevision: revision, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', displayWidth: 200, displayHeight: 100 })
  assert.equal(first.shapeRecord.id, first.shapeId)
  assert.equal(first.shapeRecord.type, 'image')
  assert.equal(first.pageId, first.shapeRecord.parentId)
  assert.deepEqual(first.bounds, { x: 0, y: 0, w: 200, h: 100 })
  assert.equal(first.replacedAiImageHolder, false)
  assert.equal(first.replacedAiDraftHolder, false)
  assert.equal(first.updatedExistingHtmlDraft, false)
  assert.ok(first.assetUrl.startsWith(`/c/${id}/assets/`))
  const second = await call('insert_cowart_image', { conversationId: id, expectedRevision: first.revision, assetUrl: first.assetUrl, anchorShapeId: first.shapeId })
  assert.equal(second.assetUrl, first.assetUrl)
  assert.deepEqual(second.bounds, { x: 240, y: 0, w: 200, h: 100 })
  const canvas = await call('get_canvas', { conversationId: id })
  assert.deepEqual(canvas.snapshot.store[second.shapeId], second.shapeRecord)
  assert.equal(canvas.snapshot.store[second.shapeRecord.props.assetId].props.src, first.assetUrl)
})
