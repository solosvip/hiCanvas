import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const run = promisify(execFile)
const agentNames = /(?:^|[/\\._-])(codex|claude|opencode|gemini|qwen|aider|goose|pi)(?:$|[/\\._-])/i
export function rexReceiver(env = process.env) {
  if (env.NODE_TEST_CONTEXT || !env.REX_SESSION || !env.REX_BLOCK) return null
  return { kind: 'rex', sessionId: env.REX_SESSION, blockId: env.REX_BLOCK, server: env.REX_SERVER || '', binary: env.REX_BIN_DIR ? `${env.REX_BIN_DIR}/rex` : 'rex' }
}
export async function callRex(receiver, method, args) {
  const { stdout } = await run(process.env.REX_BIN_DIR ? `${process.env.REX_BIN_DIR}/rex` : 'rex', ['--autostart=false', ...(receiver.server ? ['-S', receiver.server] : []), 'api', 'call', method, JSON.stringify({ session_id: receiver.sessionId, block_id: receiver.blockId, args })], { timeout: 10000, maxBuffer: 256 * 1024 })
  return JSON.parse(stdout)
}
export async function prepareRexReceiver(receiver, invoke = callRex) {
  if (!receiver) return null
  if (receiver.kind !== 'rex' || !/^session:[\w-]+$/.test(receiver.sessionId) || !/^block:[\w-]+$/.test(receiver.blockId)) throw new Error('Agent 接收位置无效。')
  if (receiver.server) {
    let url
    try { url = new URL(receiver.server) } catch { throw new Error('REX 接收端必须是本机 Unix socket。') }
    if (url.protocol !== 'unix:' || !resolve(decodeURIComponent(url.pathname)).startsWith(`${homedir()}/`)) throw new Error('REX 接收端必须是本人账户下的本机 Unix socket。')
  }
  const process = await invoke(receiver, 'com.superlogical.terminal.process', {})
  const foreground = process.foreground
  if (!foreground || ![foreground.name, foreground.path, foreground.script].some(s => typeof s === 'string' && agentNames.test(s))) throw new Error('绑定位置没有正在运行的 AI Agent。')
  if (!Number.isInteger(foreground.pid) || foreground.pid <= 0) throw new Error('无法确认 Agent 进程。')
  return { kind: 'rex', sessionId: receiver.sessionId, blockId: receiver.blockId, server: receiver.server || '', pid: foreground.pid }
}
export async function deliverRexRequest(receiver, conversationId, requestId, invoke = callRex) {
  if (!receiver) return { status: 'waiting', message: '请求已保存，等待 Agent 连接或通过 MCP 领取。' }
  const process = await invoke(receiver, 'com.superlogical.terminal.process', {})
  if (process.foreground?.pid !== receiver.pid) throw new Error('原 Agent 已退出或切换，请从当前 Agent 重新连接画板。')
  // 只发送服务生成的 ID 与固定提示；不把用户提示词当作终端按键输入。
  const text = `[hiCanvas 画板请求] 请调用 hiCanvas MCP 的 get_canvas_requests，conversationId="${conversationId}"，requestId="${requestId}"，读取用户在画板中提交的任务并执行；按请求里的目标框写回结果，最后调用 complete_canvas_request。复用当前对话，不新建画板。`
  await invoke(receiver, 'com.superlogical.terminal.write', { data: `\u001b[200~${text}\u001b[201~\r` })
  return { status: 'delivered', message: '已交给当前 Agent。' }
}
