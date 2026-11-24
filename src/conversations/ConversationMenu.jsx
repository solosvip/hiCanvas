import { useEffect, useState } from 'react'
import { ChevronDown, LayoutDashboard } from 'lucide-react'
import { TldrawUiButton, useEditor } from 'tldraw'
import { prepareCanvasNavigation } from '../canvasNavigation.js'
import { conversationApi, currentConversationId } from './client.js'
import { ConversationDialog } from './ConversationDialog.jsx'

export function ConversationMenu() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('画板')
  const id = currentConversationId()
  useEffect(() => { conversationApi('/api/conversations').then(data => setName(data.conversations.find(c => c.id === id)?.title || '画板')).catch(() => {}) }, [id])
  return <>
    <TldrawUiButton aria-label={`画板：${name}`} className="hc-conversation-trigger" title="切换画板" type="normal" onClick={() => setOpen(true)}>
      <LayoutDashboard className="hc-settings-icon" aria-hidden="true" /><span>{name}</span><ChevronDown className="hc-settings-icon" aria-hidden="true" />
    </TldrawUiButton>
    {open && <ConversationDialog currentId={id} onClose={() => setOpen(false)} beforeNavigate={() => prepareCanvasNavigation(editor)} onRename={setName} />}
  </>
}
