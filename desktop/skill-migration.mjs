import { readdir, readFile, realpath, lstat, mkdtemp, rename, symlink, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'

export async function linkPreviousSkill(previous, destination) {
  if (!previous?.destination || previous.destination === destination) return null
  const old = previous.destination
  try {
    if (await realpath(old) === await realpath(destination)) return null
    async function unchanged(directory) {
      const remaining = new Set(Object.keys(previous.hashes || {}))
      async function visit(current, prefix = '') {
        for (const entry of await readdir(current, { withFileTypes: true })) {
          const path = join(prefix, entry.name)
          if (entry.isDirectory()) { if (!await visit(join(current, entry.name), path)) return false }
          else {
            if (!entry.isFile() || !remaining.has(path)) return false
            const data = await readFile(join(current, entry.name))
            if (createHash('sha256').update(data).digest('hex') !== previous.hashes[path]) return false
            remaining.delete(path)
          }
        }
        return true
      }
      return await visit(directory) && remaining.size === 0
    }
    if ((await lstat(old)).isSymbolicLink() || !await unchanged(old)) return `原目录 ${old} 包含用户文件或修改，已保留，请手动确认其接入位置。`
    const stage = await mkdtemp(join(dirname(old), '.hicanvas-move-'))
    const held = join(stage, 'previous')
    await rename(old, held)
    try {
      if (!await unchanged(held)) { await rename(held, old); return `原目录 ${old} 在迁移期间发生修改，已保留，请手动确认其接入位置。` }
      await symlink(destination, old, 'dir')
    }
    catch (error) { await rename(held, old); throw error }
    finally { await rm(stage, { recursive: true, force: true }) }
    return null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    return `新目录已部署；原目录链接未完成：${error.message}`
  }
}
