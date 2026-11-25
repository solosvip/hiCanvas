import { useEffect, useState } from 'react'
import { ChevronDown, LayoutDashboard } from 'lucide-react'
import { TldrawUiButton, useEditor } from 'tldraw'
import { prepareCanvasNavigation } from '../canvasNavigation.js'
import { conversationApi, currentConversationId } from './client.js'
import { BoardPopover } from './BoardPopover.jsx'

export function ConversationMenu() {
  const editor = useEditor()
  const [anchor, setAnchor] = useState(null)
  const [name, setName] = useState('画板')
  const id = currentConversationId()
  useEffect(() => { conversationApi('/api/conversations').then(data => setName(data.conversations.find(c => c.id === id)?.title || '画板')).catch(() => {}) }, [id])
  return <>
    <TldrawUiButton aria-label={`画板：${name}`} aria-expanded={!!anchor} aria-haspopup="dialog" className="hc-conversation-trigger" title="切换画板" type="normal" onClick={event => setAnchor(anchor ? null : event.currentTarget)}>
      <LayoutDashboard className="hc-settings-icon" aria-hidden="true" /><span>{name}</span><ChevronDown className="hc-settings-icon" aria-hidden="true" />
    </TldrawUiButton>
    {anchor && <BoardPopover anchor={anchor} currentId={id} onClose={() => setAnchor(null)} beforeNavigate={() => prepareCanvasNavigation(editor)} onRename={setName} />}
  </>
}
