import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
export { workspaceIdentity } from '../server/workspace-identity.mjs'

export function desktopConfigDir(env = process.env) {
  return env.HICANVAS_DESKTOP_CONFIG_DIR || join(homedir(), 'Library', 'Application Support', 'hiCanvas')
}
export function localBaseUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('仅支持本机 hiCanvas 服务地址。')
  return url.origin
}
export function loadConnection(env = process.env) {
  let saved = {}
  try { saved = JSON.parse(readFileSync(join(desktopConfigDir(env), 'connection.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('桌面连接配置无法读取，请检查 connection.json。', { cause: error }) }
  const projectDir = resolve(env.HICANVAS_PROJECT_DIR || saved.projectDir || join(homedir(), 'Documents', 'hiCanvas'))
  const canvasDir = resolve(env.HICANVAS_CANVAS_DIR || (env.HICANVAS_PROJECT_DIR ? join(projectDir, 'canvas') : saved.canvasDir) || join(projectDir, 'canvas'))
  const settingsDir = resolve(env.HICANVAS_SETTINGS_DIR || (env.HICANVAS_PROJECT_DIR ? join(projectDir, 'settings') : saved.settingsDir) || join(projectDir, 'settings'))
  const baseUrl = localBaseUrl(env.HICANVAS_URL || (env.HICANVAS_PORT ? `http://127.0.0.1:${env.HICANVAS_PORT}` : saved.baseUrl) || 'http://127.0.0.1:43218')
  return { baseUrl, projectDir, canvasDir, settingsDir }
}
export function connectionEnv(connection) {
  return { HICANVAS_URL: connection.baseUrl, HICANVAS_PROJECT_DIR: connection.projectDir, HICANVAS_CANVAS_DIR: connection.canvasDir, HICANVAS_SETTINGS_DIR: connection.settingsDir }
}
export function canvasDeepLink(url, identity) {
  const target = new URL(url)
  localBaseUrl(target.origin)
  if (target.pathname !== '/') throw new Error('画板链接必须指向画板首页。')
  const link = new URL('hicanvas://open')
  link.searchParams.set('url', target.href)
  link.searchParams.set('workspace', identity)
  return link.href
}
export function parseDeepLink(value) {
  const link = new URL(value)
  if (link.protocol !== 'hicanvas:' || link.hostname !== 'open') throw new Error('无效的画板链接。')
  const url = new URL(link.searchParams.get('url'))
  localBaseUrl(url.origin)
  const workspace = link.searchParams.get('workspace')
  if (url.pathname !== '/' || !/^[a-f0-9]{64}$/.test(workspace || '')) throw new Error('无效的画板地址或资料标识。')
  return { url: url.href, baseUrl: url.origin, workspace }
}
