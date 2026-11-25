#!/usr/bin/env node
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const server = await preview({ root, configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)), logLevel: 'error' })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.httpServer.close(() => process.exit(0))
  server.httpServer.closeAllConnections()
})
