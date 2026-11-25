#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHiCanvasMcp } from '../mcp/server.mjs'
import { ensureService } from '../mcp/startup.mjs'
import { loadConnection, connectionEnv } from '../mcp/connection.mjs'
const connection = loadConnection()
Object.assign(process.env, connectionEnv(connection))
const { baseUrl } = connection
try {
  await ensureService(baseUrl)
  const server = createHiCanvasMcp({ baseUrl })
  await server.connect(new StdioServerTransport())
} catch (error) {
  process.stderr.write(`hiCanvas MCP：${error.message}\n`)
  process.exitCode = 1
}
