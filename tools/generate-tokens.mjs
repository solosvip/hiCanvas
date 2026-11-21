import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../node_modules/@google/design.md/dist/index.js', import.meta.url))
const exported = execFileSync(process.execPath, [cli, 'export', '--format', 'css-tailwind', 'DESIGN.md'], { cwd: root, encoding: 'utf8' })
const css = '/* 从 DESIGN.md 经官方 CLI 导出；运行 npm run design:tokens 更新。 */\n' + exported
  .replace('@theme', ':root')
  .replace(/(--font-[\w-]+:\s*)("(?:[^"\\]|\\.)*")/g, (_, prefix, value) => prefix + JSON.parse(value))
const target = new URL('../src/styles/tokens.css', import.meta.url)
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== css) throw new Error('设计令牌与 DESIGN.md 不一致，请运行 npm run design:tokens。')
} else {
  mkdirSync(new URL('../src/styles/', import.meta.url), { recursive: true })
  writeFileSync(target, css)
}
