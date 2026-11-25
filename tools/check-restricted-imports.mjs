import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRestrictedImports, sourceFile } from './restricted-imports.mjs'

const baselinePath = 'tools/restricted-imports-baseline.json'
export function checkRepositoryImports({ root, staged = false, base = 'HEAD', env = process.env }) {
  const git = args => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const read = path => staged ? git(['show', `:${path}`]) : readFileSync(resolve(root, path), 'utf8')
  const files = [...new Set(git(['ls-files', '--cached', ...(staged ? [] : ['--others', '--exclude-standard']), '-z']).split('\0').filter(Boolean))]
    .filter(path => sourceFile(path) && (staged || existsSync(resolve(root, path))))
  const contents = new Map(files.map(path => [path, read(path)]))
  const baseline = JSON.parse(read(baselinePath))
  let previousBaseline
  try { previousBaseline = JSON.parse(git(['show', `${base}:${baselinePath}`])) } catch { /* 首次建立基线。 */ }
  const previousFiles = new Map()
  for (const path of files.filter(path => path.startsWith('src/'))) {
    try { previousFiles.set(path, git(['show', `${base}:${path}`])) } catch { /* 新界面文件没有继承许可。 */ }
  }
  return checkRestrictedImports(contents, baseline, { previousBaseline, previousFiles })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const index = process.argv.indexOf('--base')
    const errors = checkRepositoryImports({ root, staged: process.argv.includes('--staged'), ...(index !== -1 && { base: process.argv[index + 1] }) })
    if (errors.length) throw new Error(errors.join('\n'))
    console.log('受限引用检查通过：界面引用只减不增；服务端、MCP 和桌面无直接或间接受限引用。')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
