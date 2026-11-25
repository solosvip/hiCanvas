import { mkdir, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { httpError } from './file-lock.mjs'

function name(value) {
  if (typeof value !== 'string' || !value || basename(value) !== value || /[\\/\x00-\x1f]/.test(value) || ['.', '..'].includes(value)) throw httpError('导出文件名或目录名无效。')
  return value
}
export async function saveExport(root, input) {
  const match = typeof input.dataUrl === 'string' && input.dataUrl.match(/^data:([^,]*?),(.*)$/s)
  if (!match) throw httpError('导出内容无效。')
  const bytes = /;base64$/i.test(match[1]) ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]))
  if (bytes.length > 100 * 1024 * 1024) throw httpError('导出文件超过 100 MB。')
  const base = join(root, 'exports')
  let directoryName = name(input.directoryName || 'hiCanvas')
  if (input.uniqueDirectory) {
    await mkdir(base, { recursive: true })
    const prefix = directoryName
    for (let i = 2; ; i++) {
      try { await mkdir(join(base, directoryName)); break }
      catch (e) { if (e.code !== 'EEXIST') throw e; directoryName = `${prefix}-${i}` }
    }
  }
  const directoryPath = join(base, directoryName)
  const parts = input.subdirectory ? input.subdirectory.split('/').map(name) : []
  const directory = join(directoryPath, ...parts)
  await mkdir(directory, { recursive: true })
  const fileName = name(input.fileName || 'export.bin')
  const filePath = join(directory, fileName)
  await writeFile(filePath, bytes, { flag: input.overwrite ? 'w' : 'wx', mode: 0o600 })
  return { ok: true, fileName, filePath, directoryName, directoryPath }
}
