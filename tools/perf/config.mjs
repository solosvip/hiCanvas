import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
export const directoryVariables = ['HICANVAS_PROJECT_DIR', 'HICANVAS_CANVAS_DIR', 'HICANVAS_SETTINGS_DIR', 'HICANVAS_DESKTOP_CONFIG_DIR']
export const benchmarkViewport = Object.freeze({ width: 1280, height: 800 })

function childOf(parent, child) {
  const part = relative(parent, child)
  return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

// Validate every existing ancestor before creating anything. Lexical checks alone
// would let a symlink under .scratch reach the user's real documents.
export async function scratchPath(path, root = repositoryRoot) {
  const project = await realpath(root)
  const scratch = resolve(project, '.scratch')
  const target = resolve(path)
  if (!isAbsolute(path) || !childOf(scratch, target)) throw new Error(`必须是本 worktree .scratch 下的绝对路径：${path}`)
  let ancestor = target
  while (ancestor !== project) {
    try {
      const info = await lstat(ancestor)
      if (info.isSymbolicLink()) throw new Error(`隔离目录禁止符号链接：${ancestor}`)
      const physical = await realpath(ancestor)
      if (physical !== scratch && !childOf(scratch, physical)) throw new Error(`隔离目录越界：${ancestor}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    ancestor = dirname(ancestor)
  }
  return target
}

export async function isolatedDirectories(env = process.env, root = repositoryRoot) {
  const paths = {}
  for (const name of directoryVariables) {
    if (!env[name]) throw new Error(`拒绝启动：未显式设置 ${name}`)
    paths[name] = await scratchPath(env[name], root)
  }
  return paths
}

export async function makeDirectories(paths) {
  for (const path of Object.values(paths)) await mkdir(path, { recursive: true })
}

export function parseOptions(args, env = process.env) {
  const options = { sizes: [500, 2000, 5000], runs: 3, durationMs: 2500, port: Number(env.HICANVAS_PORT), renderer: 'legacy', output: '.scratch/perf-results', loadNote: '未注明其他任务负载' }
  const names = { '--sizes': 'sizes', '--runs': 'runs', '--duration-ms': 'durationMs', '--port': 'port', '--preview-port': 'previewPort', '--renderer': 'renderer', '--output': 'output', '--load-note': 'loadNote' }
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]], value = args[i + 1]
    if (!key || !value || value.startsWith('--')) throw new Error(`无效参数：${args[i]}`)
    options[key] = key === 'sizes' ? value.split(',').map(Number) : ['runs', 'durationMs', 'port', 'previewPort'].includes(key) ? Number(value) : value
  }
  if (!options.sizes.length || options.sizes.some(n => !Number.isInteger(n) || n < 10 || n > 10000) || new Set(options.sizes).size !== options.sizes.length) throw new Error('sizes 需要不重复的整数（10–10000）。')
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 20) throw new Error('runs 需要 1–20。正式基线至少 3 次。')
  if (!Number.isInteger(options.durationMs) || options.durationMs < 500 || options.durationMs > 30000) throw new Error('duration-ms 需要 500–30000。')
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535 || [43218, 43219].includes(options.port)) throw new Error('显式指定已登记的端口（不能用 43218、43219）。')
  if (!['legacy', 'preview', 'both'].includes(options.renderer)) throw new Error('renderer 需要 legacy、preview 或 both。')
  if (options.renderer !== 'legacy') {
    if (!Number.isInteger(options.previewPort) || options.previewPort < 43300 || options.previewPort > 65535 || options.previewPort === options.port) throw new Error('显式指定不同的预览端口（43300–65535）。')
    if (options.sizes.some(n => ![500, 2000, 5000].includes(n))) throw new Error('新预览只支持 500、2000、5000 三档规模。')
  }
  return options
}

export function measurementPlan({ renderer, sizes, runs }) {
  const renderers = renderer === 'both' ? ['legacy', 'preview'] : [renderer]
  return Array.from({ length: runs }, (_, i) => sizes.flatMap(count => renderers.map(renderer => ({ renderer, count, repeat: i + 1 })))).flat()
}

export function median(values) {
  if (!values.length || values.some(n => !Number.isFinite(n))) throw new Error('中位数需要非空的有限数值。')
  const sorted = values.toSorted((a, b) => a - b), mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function summarizeFrames(timestamps, start, end) {
  if (!(end > start)) throw new Error('帧采样时段无效。')
  const times = timestamps.filter(t => t >= start && t <= end)
  const intervals = [...times.map((t, i) => t - (i ? times[i - 1] : start)), end - (times.at(-1) ?? start)].toSorted((a, b) => a - b)
  return { frames: times.length, elapsedMs: end - start, fps: times.length * 1000 / (end - start), p95FrameMs: intervals[Math.ceil(intervals.length * .95) - 1], maxFrameMs: intervals.at(-1) }
}

export function phaseChanged(name, before, after, zoomRange) {
  if (name === 'pan') return Math.hypot(after.camera.x - before.camera.x, after.camera.y - before.camera.y) > 1
  // Relative zoom works at every fixture scale; a completed round trip is also
  // real input even if its endpoint nearly equals the starting camera.
  if (name === 'zoom') return Math.abs(after.camera.z / before.camera.z - 1) > .001 || zoomRange.max / zoomRange.min > 1.001
  return Math.hypot(after.shape.x - before.shape.x, after.shape.y - before.shape.y) > 1
}
