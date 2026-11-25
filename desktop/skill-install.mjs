import { readdir, readFile, writeFile, mkdir, realpath, lstat, mkdtemp, cp, rename, rm, readlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
const digest = data => createHash('sha256').update(data).digest('hex')
async function json(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function files(root, prefix = '') {
  const result = {}
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) Object.assign(result, await files(root, path))
    else if (entry.isFile()) result[path] = await readFile(join(root, path))
    else throw new Error('随附 Skill 包含不支持的文件。')
  }
  return result
}
async function existingFile(root, path) {
  let current = root
  for (const part of path.split('/')) {
    current = join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Skill 文件包含符号链接，请选择其他目录或手动整理后重试。') }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  return readFile(current)
}
async function fingerprint(root, prefix = '') {
  const result = {}
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(prefix, entry.name), full = join(root, path)
    if (entry.isDirectory()) { result[path] = 'directory'; Object.assign(result, await fingerprint(root, path)) }
    else result[path] = entry.isSymbolicLink() ? `link:${await readlink(full)}` : digest(await readFile(full))
  }
  return result
}
export async function skillInstallState(configDirectory) {
  return json(join(configDirectory, 'skill-install.json'))
}

export async function installSkill({ bundleDirectory, skillDirectory, configDirectory, command, version, backup = false }) {
  const directory = await realpath(skillDirectory)
  const requested = join(directory, 'hicanvas')
  let destination = requested, exists = false
  try {
    destination = await realpath(requested)
    if (!(await lstat(destination)).isDirectory()) throw new Error('hicanvas 已存在，但不是文件夹。')
    exists = true
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const bundled = await files(bundleDirectory)
  bundled['installation.json'] = Buffer.from(JSON.stringify({ version, command, skillDirectory: directory, skillPath: destination, transport: 'stdio' }, null, 2) + '\n')
  const previous = await skillInstallState(configDirectory)
  const initial = exists ? JSON.stringify(await fingerprint(destination)) : null
  const hashes = Object.fromEntries(Object.entries(bundled).map(([path, data]) => [path, digest(data)]))
  const conflicts = []
  if (exists) for (const [path, data] of Object.entries(bundled)) {
    const current = await existingFile(destination, path)
    if (!current && previous?.destination === destination && previous.hashes?.[path]) conflicts.push(path)
    else if (current && digest(current) !== digest(data) && !(previous?.destination === destination && previous.hashes?.[path] === digest(current))) conflicts.push(path)
  }
  if (conflicts.length && !backup) return { status: 'conflict', directory, destination, conflicts }
  await mkdir(configDirectory, { recursive: true })
  let backupDirectory
  if (conflicts.length) {
    backupDirectory = await mkdtemp(join(configDirectory, 'skill-backup-'))
    await cp(destination, backupDirectory, { recursive: true, dereference: false })
  }
  const staging = await mkdtemp(join(dirname(destination), '.hicanvas-install-'))
  const next = join(staging, 'next'), old = join(staging, 'previous')
  let movedOld = false, movedNew = false
  try {
    if (exists) await cp(destination, next, { recursive: true, dereference: false })
    else await mkdir(next)
    for (const [path, data] of Object.entries(bundled)) {
      await mkdir(dirname(join(next, path)), { recursive: true })
      await writeFile(join(next, path), data)
    }
    if (exists) {
      await rename(destination, old); movedOld = true
      if (JSON.stringify(await fingerprint(old)) !== initial) throw new Error('部署期间 Skill 已被修改，原文件已保留，请重试。')
    }
    await rename(next, destination); movedNew = true
    const manifest = join(configDirectory, 'skill-install.json')
    await writeFile(manifest + '.tmp', JSON.stringify({ status: 'installed', directory, destination, version, hashes, backupDirectory }, null, 2) + '\n')
    await rename(manifest + '.tmp', manifest)
  } catch (error) {
    if (movedNew) await rm(destination, { recursive: true, force: true })
    if (movedOld) await rename(old, destination)
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
    await rm(join(configDirectory, 'skill-install.json.tmp'), { force: true })
  }
  return { status: 'installed', directory, destination, version, backupDirectory }
}
