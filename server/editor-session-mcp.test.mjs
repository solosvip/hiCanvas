import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHiCanvasMcp } from '../mcp/server.mjs'

test('编辑器提高事务上限后 MCP 工具定义依然拒绝 501 条操作', async t => {
  const [a, b] = InMemoryTransport.createLinkedPair()
  const server = createHiCanvasMcp({ baseUrl: 'http://127.0.0.1:1', open: async () => {} })
  const client = new Client({ name: 'synthetic-limit-check', version: '1' })
  await server.connect(b)
  await client.connect(a)
  t.after(async () => { await client.close(); await server.close() })
  const definition = (await client.listTools()).tools.find(tool => tool.name === 'apply_canvas_operations')
  assert.equal(definition.inputSchema.properties.operations.maxItems, 500)
  const result = await client.callTool({ name: definition.name, arguments: { conversationId: 'legacy', expectedRevision: 'synthetic', operations: Array(501).fill({ type: 'delete', ids: [] }) } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /500/)
  assert.doesNotMatch(result.content[0].text, /fetch failed|ECONNREFUSED/)
})
