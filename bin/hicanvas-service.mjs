#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadConnection } from '../mcp/connection.mjs'
import { createHiCanvasService } from '../server/local-service.mjs'
const connection = loadConnection()
const appRoot = process.env.HICANVAS_APP_ROOT || fileURLToPath(new URL('../', import.meta.url))
const server = createHiCanvasService({ ...connection, distDir: join(appRoot, 'dist') })
server.listen(Number(new URL(connection.baseUrl).port || 80), '127.0.0.1')
server.on('error', error => { process.stderr.write(`hiCanvas：${error.message}\n`); process.exit(1) })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0))
  server.closeAllConnections()
})
