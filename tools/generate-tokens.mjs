import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../node_modules/@google/design.md/dist/index.js', import.meta.url))
const exported = execFileSync(process.execPath, [cli, 'export', '--format', 'css-tailwind', 'DESIGN.md'], { cwd: root, encoding: 'utf8' })
const css = '/* 从 DESIGN.md 经官方 CLI 导出；运行 npm run design:tokens 更新。 */\n' + exported
  .replace('@theme', ':root')
  .replace(/(--font-[\w-]+:\s*)("(?:[^"\\]|\\.)*")/g, (_, prefix, value) => prefix + JSON.parse(value))
const numericTokens = {
  handleCornerHitSize: 'overlay-handle-hit', handleEdgeHitSize: 'overlay-edge-hit',
  handleRotationOffset: 'overlay-rotate-offset', handleRotationRadius: 'overlay-rotate-radius',
}
const values = Object.entries(numericTokens).map(([name, token]) => {
  const match = css.match(new RegExp(`--spacing-${token}:\\s*([0-9.]+)px;`))
  const value = Number(match?.[1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`手柄令牌需要正数 px：${token}`)
  return `export const ${name} = ${value}\n`
}).join('')
const js = '// 从 DESIGN.md 经同一次官方 CSS 导出生成；运行 npm run design:tokens 更新。\n' + values
for (const [file, content] of [['tokens.css', css], ['tokens.js', js]]) {
  const target = new URL(`../src/styles/${file}`, import.meta.url)
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content) throw new Error(`设计令牌 ${file} 与 DESIGN.md 不一致，请运行 npm run design:tokens。`)
  } else {
    mkdirSync(new URL('../src/styles/', import.meta.url), { recursive: true })
    writeFileSync(target, content)
  }
}
