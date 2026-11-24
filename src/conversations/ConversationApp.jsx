import { useEffect, useState } from 'react'
import App from '../editor/App.jsx'
import { initializeConversation } from './client.js'
import { BoardHome } from './BoardHome.jsx'

export function ConversationApp() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [empty, setEmpty] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    function deleted() {
      document.title = 'hiCanvas'
      history.replaceState(null, '', '/')
      try { localStorage.removeItem('hicanvas:last-conversation') } catch { /* 本机偏好可禁用。 */ }
      setMessage('画板已删除'); setEmpty(true)
    }
    window.addEventListener('hicanvas:board-deleted', deleted)
    initializeConversation().then(board => { if (active) { setEmpty(!board); setReady(true) } }).catch(e => {
      if (!active) return
      if (e.status === 410 || e.status === 404) { deleted(); setReady(true) } else setError(e.message)
    })
    return () => { active = false; window.removeEventListener('hicanvas:board-deleted', deleted) }
  }, [])
  if (error) return <main className="cowart-status" role="alert">{error}<button onClick={() => location.reload()} type="button">重试</button></main>
  if (!ready) return <main className="cowart-status" role="status">正在打开画板…</main>
  if (empty) return <BoardHome message={message} />
  return <App />
}
