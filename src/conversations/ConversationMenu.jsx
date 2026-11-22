import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, LayoutDashboard, Plus, X } from 'lucide-react'
import { TldrawUiButton, useEditor } from 'tldraw'
import { prepareCanvasNavigation } from '../canvasNavigation.js'
import { conversationApi, conversationUrl, currentConversationId } from './client.js'

export function ConversationMenu() {
  const editor = useEditor()
  const dialog = useRef(null)
  const [open, setOpen] = useState(false)
  const [conversations, setConversations] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const id = currentConversationId()
  const active = conversations.find(c => c.id === id)
  const reload = () => conversationApi('/api/conversations').then(data => { setConversations(data.conversations); setError('') }).catch(e => setError(e.message))
  useEffect(() => { reload() }, [])
  useEffect(() => {
    if (open) { reload(); dialog.current?.showModal() } else dialog.current?.close()
  }, [open])
  async function navigate(nextId) {
    setBusy(true); setError('')
    try {
      // 切换前先落盘；冲突或断网时保留当前画板，不跳到另一个画板。
      await prepareCanvasNavigation(editor)
      location.assign(conversationUrl(nextId))
    } catch (e) { setError(`当前画板尚未保存，已停止切换。${e.message}`); setBusy(false) }
  }
  async function create(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await prepareCanvasNavigation(editor)
      const { conversation } = await conversationApi('/api/conversations/open', 'POST', { title: title.trim() || '新画板' })
      location.assign(conversationUrl(conversation.id))
    } catch (e) { setError(e.message); setBusy(false) }
  }
  async function rename(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await conversationApi(`/api/conversations/${id}`, 'PUT', { title })
      document.title = `${title.trim()} · hiCanvas`
      await reload(); setCreating(false); setTitle('')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <>
    <TldrawUiButton aria-label={`画板：${active?.title || '我的画板'}`} className="hc-conversation-trigger" title="切换画板" type="normal" onClick={() => setOpen(true)}>
      <LayoutDashboard className="hc-settings-icon" aria-hidden="true" /><span>{active?.title || '我的画板'}</span><ChevronDown className="hc-settings-icon" aria-hidden="true" />
    </TldrawUiButton>
    {createPortal(<dialog className="hc-conversation-dialog hc-model-dialog" ref={dialog} aria-labelledby="hc-conversation-title" onCancel={event => { if (busy) event.preventDefault(); else setOpen(false) }} onClose={() => { setOpen(false); setCreating(false); setTitle('') }} onClick={event => { if (event.target === dialog.current && !busy) setOpen(false) }}>
      <div className="hc-model-heading"><div><span className="hc-model-eyebrow">你的创作空间</span><h2 id="hc-conversation-title">画板</h2></div><button className="hc-model-close" aria-label="关闭画板列表" type="button" disabled={busy} onClick={() => setOpen(false)}><X className="hc-settings-icon" aria-hidden="true" /></button></div>
      <p>每个画板都是独立的无限画布，作品与图片分别保存。</p>
      {error && <p className="hc-model-error" role="alert">{error}</p>}
      <ul className="hc-conversation-list">{conversations.map(c => <li key={c.id}><button type="button" aria-current={c.id === id ? 'true' : undefined} disabled={busy} onClick={() => c.id === id ? setOpen(false) : navigate(c.id)}><span><strong>{c.title}</strong><small>{c.id === id ? '当前画板' : new Date(c.createdAt).toLocaleDateString('zh-CN')}</small></span>{c.id === id && <Check className="hc-settings-icon" aria-hidden="true" />}</button></li>)}</ul>
      {creating ? <form onSubmit={creating === 'rename' ? rename : create} className="hc-conversation-form"><label htmlFor="hc-conversation-name">画板名称</label><input autoFocus id="hc-conversation-name" value={title} maxLength={100} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="例如：品牌海报" /><div className="hc-model-actions"><button className="hc-primary" disabled={busy || (creating === 'rename' && !title.trim())} type="submit">{busy ? '保存中…' : creating === 'rename' ? '保存名称' : '创建画板'}</button><button type="button" disabled={busy} onClick={() => { setCreating(false); setTitle('') }}>取消</button></div></form> : <div className="hc-model-actions"><button className="hc-primary hc-conversation-add" type="button" disabled={busy} onClick={() => { setCreating('new'); setTitle('') }}><Plus className="hc-settings-icon" aria-hidden="true" />新建画板</button><button type="button" disabled={busy} onClick={() => { setCreating('rename'); setTitle(active?.title || '') }}>重命名当前画板</button></div>}
    </dialog>, document.body)}
  </>
}
