import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { canvasStoragePlugin } from './server/routes.mjs'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version
const port = Number(process.env.HICANVAS_PORT ?? 43218)

export default defineConfig({
  plugins: [react(), canvasStoragePlugin()],
  define: {
    __COWART_WIDGET_BUILD__: 'false',
    __COWART_APP_VERSION__: JSON.stringify(version),
  },
  build: { assetsInlineLimit: Number.MAX_SAFE_INTEGER, assetsDir: 'app-assets' },
  server: { host: '127.0.0.1', port, strictPort: true },
  preview: { host: '127.0.0.1', port, strictPort: true },
})
