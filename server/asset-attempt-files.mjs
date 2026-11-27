import { mkdir, open, realpath, lstat, unlink } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'
import { httpError } from './file-lock.mjs'

// A file belongs to an attempt only after exclusive creation. Reused files
// never enter this ledger; protecting a saved URL permanently releases it.
export function createAttemptFiles(root) {
  const owned = new Map()
  async function checkDirectory(path) {
    const base = await realpath(root), dir = await realpath(dirname(path)), delta = relative(base, dir)
    if (delta === '..' || delta.startsWith('..' + sep) || delta.startsWith(sep)) throw httpError('目标资源目录不能指向画板外。', 403)
  }
  return {
    get size() { return owned.size },
    has(url) { return owned.has(url) },
    protect(urls) { for (const url of urls) owned.delete(url) },
    async write(destination, bytes) {
      await mkdir(root, { recursive: true })
      // Validate before mkdir: a supplied path must never create outside roots.
      const delta = relative(root, destination.assetPath)
      if (!delta || delta === '..' || delta.startsWith('..' + sep) || delta.startsWith(sep)) throw httpError('目标资源目录无效。', 403)
      await mkdir(dirname(destination.assetPath), { recursive: true })
      await checkDirectory(destination.assetPath)
      const handle = await open(destination.assetPath, 'wx', 0o600)
      try {
        const identity = await handle.stat()
        owned.set(destination.assetUrl, { ...destination, dev: identity.dev, ino: identity.ino })
        await handle.writeFile(bytes)
      } finally { await handle.close() }
      return destination
    },
    async rollback() {
      let removed = 0
      const failures = []
      for (const [url, file] of owned) {
        try {
          await checkDirectory(file.assetPath)
          const identity = await lstat(file.assetPath)
          if (!identity.isFile() || identity.dev !== file.dev || identity.ino !== file.ino) throw httpError('本次资源文件身份已变化，已保留。', 409)
          await unlink(file.assetPath); owned.delete(url); removed++
        } catch (error) {
          if (error.code === 'ENOENT') owned.delete(url)
          else failures.push(error)
        }
      }
      return { removed, remaining: owned.size, failures }
    },
  }
}
