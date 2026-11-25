import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, X } from 'lucide-react'
import { BoardActions } from './BoardActions.jsx'
import { conversationApi, conversationUrl } from './client.js'

export function BoardPopover({ anchor, currentId = null, onClose, beforeNavigate = async () => {}, onRename = () => {}, startCreating = false }) {
  const dialog = useRef(null)
  const cancel = useRef(null)
  const [boards, setBoards] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(startCreating ? { type: 'new' } : null)
  const [title, setTitle] = useState('')
  const reload = async () => { const data = await conversationApi('/api/conversations'); setBoards(data.conversations); setLoaded(true) }
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement
    node.showPopover()
    function position() {
      const box = anchor.getBoundingClientRect()
      const gap = parseFloat(getComputedStyle(node).getPropertyValue('--spacing-sm'))
      node.style.left = `${Math.max(gap, Math.min(box.left, innerWidth - node.offsetWidth - gap))}px`
      node.style.top = `${Math.max(gap, Math.min(box.bottom + gap, innerHeight - node.offsetHeight - gap))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(node)
    window.addEventListener('resize', position)
    reload().catch(e => setError(e.message))
    return () => { observer.disconnect(); window.removeEventListener('resize', position); node.hidePopover(); if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    if (form?.type === 'delete') cancel.current?.focus()
    else if (!form && loaded) dialog.current?.querySelector('.hc-board-open[aria-current], .hc-board-open, .hc-conversation-add')?.focus()
  }, [form, loaded])
  async function run(action) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const navigate = id => run(async () => { await beforeNavigate(); location.assign(conversationUrl(id)) })
  function edit(board) { setForm({ type: 'rename', board }); setTitle(board.title); setError('') }
  function requestDelete(board) {
    run(async () => {
      if (board.id === currentId) await beforeNavigate()
      const state = await conversationApi(`/api/canvas?conversation=${encodeURIComponent(board.id)}`)
      setForm({ type: 'delete', board, revision: state.revision })
    })
  }
  function save(event) {
    event.preventDefault()
    run(async () => {
      if (form.type === 'rename') {
        const { conversation } = await conversationApi(`/api/conversations/${form.board.id}`, 'PUT', { title })
        if (conversation.id === currentId) { document.title = `${conversation.title} · hiCanvas`; onRename(conversation.title) }
        await reload(); setForm(null)
      } else {
        await beforeNavigate()
        const { conversation } = await conversationApi('/api/conversations/open', 'POST', { title: title.trim() || '新画板' })
        await beforeNavigate()
        location.assign(conversationUrl(conversation.id))
      }
    })
  }
  function remove() {
    run(async () => {
      const result = await conversationApi(`/api/conversations/${form.board.id}`, 'DELETE', { expectedRevision: form.revision })
      if (form.board.id === currentId) location.replace(result.nextConversationId ? conversationUrl(result.nextConversationId) : '/')
      else { await reload(); setForm(null) }
    })
  }
  function dismiss() { if (form) { setForm(null); setError('') } else onClose() }
  function keyboard(event) {
    if (form || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target.closest('[role="menu"]')) return
    const buttons = [...dialog.current.querySelectorAll('.hc-board-open, .hc-board-more, .hc-conversation-add')].filter(button => !button.disabled)
    if (!buttons.length) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
    buttons[next].focus()
  }
  return createPortal(<section className="hc-board-popover hc-model-dialog" ref={dialog} popover="auto" role="dialog" aria-label="画板" onToggle={event => { if (event.target === dialog.current && event.newState === 'closed') onClose() }} onKeyDown={keyboard}>
    {form && <div className="hc-model-heading"><h2>{form.type === 'delete' ? '删除画板？' : form.type === 'rename' ? '重命名画板' : '新建画板'}</h2><button className="hc-model-close" aria-label="返回画板列表" type="button" disabled={busy} onClick={dismiss}><X className="hc-settings-icon" aria-hidden="true" /></button></div>}
    {error && <p className="hc-model-error" role="alert">{error}</p>}
    {form?.type === 'delete' ? <>
      <p className="hc-board-delete-name">{form.board.title}</p>
      <p>删除后，该画板将从列表移除，连接它的 Agent 将停止读写。尚未发出的生图任务将停止。</p>
      <p className="hc-model-help">本机作品文件会保留。</p>
      <div className="hc-model-actions hc-board-confirm"><button ref={cancel} type="button" disabled={busy} onClick={() => { setForm(null); setError('') }}>取消</button><button className="hc-danger-primary" type="button" disabled={busy} onClick={remove}>{busy ? '删除中…' : '确认删除'}</button></div>
    </> : form ? <form onSubmit={save} className="hc-conversation-form"><label htmlFor="hc-conversation-name">画板名称</label><input autoFocus id="hc-conversation-name" value={title} maxLength={100} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="例如：品牌海报" /><div className="hc-model-actions"><button className="hc-primary" disabled={busy || (form.type === 'rename' && !title.trim())} type="submit">{busy ? '保存中…' : form.type === 'rename' ? '保存名称' : '创建画板'}</button><button type="button" disabled={busy} onClick={dismiss}>取消</button></div></form> : <>
      {!loaded ? <p role="status">正在加载画板…</p> : !boards.length ? <p className="hc-board-empty">还没有画板，新建一个开始创作。</p> : <ul className="hc-conversation-list">{boards.map(board => <li key={board.id} className={board.id === currentId ? 'hc-board-current' : undefined}><button className="hc-board-open" type="button" aria-current={board.id === currentId ? 'true' : undefined} disabled={busy} onClick={() => board.id === currentId ? onClose() : navigate(board.id)}><span><strong>{board.title}</strong></span>{board.id === currentId && <Check className="hc-settings-icon" aria-hidden="true" />}</button><BoardActions board={board} disabled={busy} onRename={edit} onDelete={requestDelete} /></li>)}</ul>}
      <div className="hc-model-actions"><button className="hc-primary hc-conversation-add" type="button" disabled={busy} onClick={() => { setForm({ type: 'new' }); setTitle(''); setError('') }}><Plus className="hc-settings-icon" aria-hidden="true" />新建画板</button></div>
    </>}
  </section>, document.body)
}
