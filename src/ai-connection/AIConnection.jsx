import { useEffect, useState } from 'react'
import { Check, Copy, FolderOpen } from 'lucide-react'

export function AIConnection() {
  const desktop = window.hiCanvasDesktop
  const [state, setState] = useState({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    if (!desktop) return
    let live = true
    desktop.skillStatus().then(value => { if (live) setState(value) }).catch(error => { if (live) setState({ status: 'error', message: error.message }) })
    const timer = setInterval(() => desktop.skillStatus().then(value => { if (live) setState(value) }).catch(() => {}), 1000)
    return () => { live = false; clearInterval(timer) }
  }, [desktop])
  async function run(action) {
    setBusy(true); setFeedback('')
    try { await action() } catch (error) { setFeedback(error.message) } finally { setBusy(false) }
  }
  return <div className="hc-ai-connection">
    <h3>让 AI 使用你的画板</h3>
    <p className="hc-model-help">复制接入指令，发给 Rex 或其他客户端里的 AI。它会读取本机说明，配置 MCP 并检查连接。</p>
    {!desktop ? <p role="status">请在 hiCanvas 桌面应用中部署 Skill 和复制接入指令。</p> : <>
      <div className="hc-ai-installation">
        <span className="hc-ai-status">{state.status === 'installed' ? <><Check className="hc-settings-icon" aria-hidden="true" />Skill 已部署</> : state.status === 'conflict' ? '现有 Skill 已保留，尚未更新' : state.status === 'checking' ? '正在检查 Skill…' : 'Skill 尚未部署'}</span>
        {state.directory && <code>{state.destination || state.directory}</code>}
        {state.message && <p role={state.status === 'error' ? 'alert' : 'status'} className={state.status === 'error' ? 'hc-model-error' : undefined}>{state.message}</p>}
        <div className="hc-model-actions">
          <button className="hc-primary" disabled={busy || state.status !== 'installed'} onClick={() => run(async () => setFeedback(await desktop.copySkillPrompt()))} type="button"><Copy className="hc-settings-icon" aria-hidden="true" />复制接入指令</button>
          <button disabled={busy} onClick={() => run(async () => setState(await desktop.chooseSkillDirectory()))} type="button"><FolderOpen className="hc-settings-icon" aria-hidden="true" />{state.directory ? '更改部署目录' : '选择部署目录'}</button>
        </div>
      </div>
      {feedback && <p role="status">{feedback}</p>}
    </>}
    <p className="hc-model-help">Skill 随应用更新；找不到目录时由你选择。MCP 使用应用自带的运行环境，无需另装 Node。</p>
  </div>
}
