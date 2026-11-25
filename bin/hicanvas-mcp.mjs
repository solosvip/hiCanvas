#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHiCanvasMcp } from '../mcp/server.mjs'
import { ensureService } from '../mcp/startup.mjs'
const baseUrl = process.env.HICANVAS_URL || `http://127.0.0.1:${process.env.HICANVAS_PORT || 43218}`
try {
  await ensureService(baseUrl)
  const server = createHiCanvasMcp({ baseUrl })
  await server.connect(new StdioServerTransport())
} catch (error) {
  process.stderr.write(`hiCanvas MCP：${error.message}\n`)
  process.exitCode = 1
}
