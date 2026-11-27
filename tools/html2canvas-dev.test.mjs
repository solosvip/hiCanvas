import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
import { build } from 'esbuild'

test('裁剪修补保留祖先变换后裁剪的顺序及当前层效果', async () => {
  await import('../content-channel/index.js')
  const { ElementPaint } = await import('html2canvas/dist/lib/render/stacking-context.js')
  const { ClipEffect, TransformEffect, OpacityEffect } = await import('html2canvas/dist/lib/render/effects.js')
  const transform = new TransformEffect(40, 30, [1, 0, 0, 1, -40, -30])
  const childEffect = new OpacityEffect(0.8)
  const curves = Object.fromEntries(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
    .flatMap(corner => ['BorderBox', 'PaddingBox'].map(box => [corner + box, {}])))
  const parent = {
    parent: null, curves,
    container: { styles: { position: 0, overflowX: 1 } },
    effects: [transform, new ClipEffect([], 2)],
  }
  const paint = Object.assign(Object.create(ElementPaint.prototype), {
    parent, container: { styles: { position: 0 } }, effects: [childEffect],
  })
  const effects = paint.getEffects(4)
  assert.equal(effects[0], transform, '先应用祖先变换，不能把裁剪提前到变换之前')
  assert.ok(effects[1] instanceof ClipEffect)
  assert.deepEqual(effects[1].path, ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(corner => curves[corner + 'PaddingBox']))
  assert.equal(effects[2], childEffect, '当前层效果继续保留')
  assert.deepEqual(paint.getEffects(1), [], '不适用的绘制目标仍被滤掉')
})

test('真实 Vite 开发转换后的 HTML 捕获入口可加载，裁剪与克隆修补不会因 CommonJS 默认导入崩溃', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'hicanvas-capture-dev-'))
  let server, http
  t.after(async () => {
    try {
      http?.closeAllConnections()
      if (http?.listening) await new Promise(resolve => http.close(resolve))
    } finally {
      try { await server?.close() }
      finally { await rm(cacheDir, { recursive: true, force: true }) }
    }
  })
  // No application/storage plugins: this test serves only the actual capture
  // modules and dependencies, never a default project or provider configuration.
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: { entries: ['content-channel/index.js'] },
    server: { middlewareMode: true, hmr: false },
  })
  http = createHttpServer(server.middlewares)
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${http.address().port}`
  // Execute the browser's *already transformed* ESM graph. Rebundling that
  // output preserves Vite's interop expressions; bundling the source directly
  // would skip the development-only bug and give a false green result.
  const result = await build({
    entryPoints: [base + '/content-channel/index.js'],
    bundle: true, write: false, format: 'cjs', platform: 'browser', logLevel: 'silent',
    plugins: [{
      name: 'served-vite-modules',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => ({
          path: new URL(args.path, args.importer || base).href,
          namespace: 'served-vite',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'served-vite' }, async args => {
          const response = await fetch(args.path, { signal: t.signal })
          assert.equal(response.status, 200, `开发模块加载失败：${args.path}`)
          return { contents: await response.text(), loader: 'js' }
        })
      },
    }],
  })
  const module = { exports: {} }
  try {
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports }, { timeout: 1000 })
  } catch (error) {
    // Report the application error without dumping the bundled dependency stack.
    assert.fail(`开发模式 HTML 捕获入口加载失败：${error.message}`)
  }
  assert.equal(typeof module.exports.renderHtmlDraftDocument, 'function', '捕获入口应加载完成，供内容页内部截图使用')
})
