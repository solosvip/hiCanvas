import { useEffect, useState } from 'react'
import { LayoutDashboard, Plus } from 'lucide-react'
import { BoardPopover } from './BoardPopover.jsx'
import { conversationApi } from './client.js'

export function BoardHome({ message }) {
  const [form, setForm] = useState(null)
  const [hasBoards, setHasBoards] = useState(false)
  useEffect(() => { conversationApi('/api/conversations').then(data => setHasBoards(data.conversations.length > 0)).catch(() => {}) }, [form])
  return <main className="hc-board-home"><div className="hc-board-welcome hc-model-dialog">
    <LayoutDashboard className="hc-board-home-icon" aria-hidden="true" />
    <h1>{message || '还没有画板'}</h1><p>{hasBoards ? '选择一个画板继续，或开始新的创作。' : '一张无限画布，放下你的所有灵感。'}</p>
    <div className="hc-model-actions"><button className="hc-primary hc-conversation-add" type="button" onClick={event => setForm({ type: 'new', anchor: event.currentTarget })}><Plus className="hc-settings-icon" aria-hidden="true" />新建画板</button>{hasBoards && <button type="button" onClick={event => setForm({ type: 'list', anchor: event.currentTarget })}>选择画板</button>}</div>
  </div>{form && <BoardPopover anchor={form.anchor} startCreating={form.type === 'new'} onClose={() => setForm(null)} />}</main>
}
