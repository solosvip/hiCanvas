import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { serveCanvasAsset } from '../server/storage.mjs'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const resources = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(match => match[1])
assert.ok(resources.length >= 2, '构建页面必须引用可加载的脚本与样式。')
for (const url of resources) {
  let passed = false
  await serveCanvasAsset({ url }, {}, () => { passed = true })
  assert.ok(passed, `应用资源被误当作用户画板资源：${url}`)
  assert.ok(existsSync(new URL(`../dist${url}`, import.meta.url)), `构建资源不存在：${url}`)
}
console.log('生产页面的脚本与样式均存在，且不会被画板资源路由拦截。')
