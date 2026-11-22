import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { styleLiterals, addedStyleLiterals } from './style-values.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const staged = process.argv.includes('--staged')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const read = path => staged ? git(['show', `:${path}`]) : readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const baseline = JSON.parse(read('tools/upstream-styles.json'))
const files = [...new Set(git(['ls-files', '--cached', ...(staged ? [] : ['--others', '--exclude-standard']), '-z']).split('\0'))]
  .filter(path => path.startsWith('src/') && /\.(?:css|[jt]sx)$/.test(path) && path !== 'src/styles/tokens.css')
const errors = files.flatMap(path => addedStyleLiterals(styleLiterals(path, read(path)), baseline[path])
  .map(value => `${path}: ${value}`))
if (errors.length) {
  throw new Error(`新增界面样式必须引用 DESIGN.md 生成的令牌：\n${errors.join('\n')}`)
}
console.log('界面样式检查通过；继承的 Cowart 样式基线未增加字面量。')
