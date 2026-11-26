import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { imageToolsPlugin } from './server/image-routes.mjs'
import { canvasStoragePlugin } from './server/routes.mjs'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version
const port = Number(process.env.HICANVAS_PORT ?? 43218)

export default defineConfig({
  plugins: [react(), imageToolsPlugin(), canvasStoragePlugin()],
  define: {
    __COWART_WIDGET_BUILD__: 'false',
    __COWART_APP_VERSION__: JSON.stringify(version),
  },
  // Font bytes remain reusable files; loading sixteen base64 copies in JS would
  // delay startup. Preserve the existing inline rule for all other assets.
  build: { assetsInlineLimit: (path, bytes) => !path.endsWith('.woff2') && bytes.length < Number.MAX_SAFE_INTEGER, assetsDir: 'app-assets' },
  server: { host: '127.0.0.1', port, strictPort: true },
  preview: { host: '127.0.0.1', port, strictPort: true },
})
