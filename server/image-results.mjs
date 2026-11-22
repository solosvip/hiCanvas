import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function createImageResults(assetsDir) {
  return {
    async save(images) {
      await mkdir(assetsDir, { recursive: true })
      const results = []
      for (const image of images) {
        const name = `generated-${randomUUID()}.${image.extension}`
        await writeFile(join(assetsDir, name), image.bytes, { flag: 'wx', mode: 0o600 })
        results.push({ src: `/assets/${name}`, createdAt: new Date().toISOString() })
      }
      return results
    },
    async list() {
      let names
      try { names = await readdir(assetsDir) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const entries = await Promise.all(names.filter(name => /^generated-[\w-]+\.(png|jpg|webp)$/.test(name)).map(async name => ({
        src: `/assets/${name}`, createdAt: (await stat(join(assetsDir, name))).mtime.toISOString()
      })))
      return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40)
    }
  }
}
