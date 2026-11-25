import { realpath, access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, dirname, basename } from 'node:path'

async function directory(path) {
  try {
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) return null
    await access(canonical, constants.W_OK)
    return canonical
  } catch { return null }
}

export async function discoverSkillDirectory({ home, env = {}, savedDirectory }) {
  if (savedDirectory) {
    const saved = await directory(savedDirectory)
    if (saved) return { directory: saved, candidates: [saved] }
    return { directory: null, candidates: [], reason: 'saved-missing' }
  }
  const paths = [join(home, '.agents/skills'), join(home, '.claude/skills'), join(home, '.codex/skills'), join(home, '.config/opencode/skills'), join(home, '.pi/agent/skills'), join(home, 'Documents/skills')]
  if (env.CODEX_HOME) paths.unshift(join(env.CODEX_HOME, 'skills'))
  const roots = [...new Set((await Promise.all(paths.map(directory))).filter(Boolean))]
  // 已部署技能的符号链接指向共享目录时，以真实目录为准，不在每个客户端各复制一份。
  const installed = new Map()
  for (const root of roots) {
    const skill = await directory(join(root, 'hicanvas'))
    if (skill && !installed.has(skill)) installed.set(skill, basename(skill) === 'hicanvas' ? dirname(skill) : root)
  }
  const candidates = installed.size ? [...installed.values()] : roots
  return { directory: candidates.length === 1 ? candidates[0] : null, candidates, reason: candidates.length === 1 ? 'found' : candidates.length ? 'multiple' : 'not-found' }
}
