import { useEffect, useState } from 'react'
import App from '../editor/App.jsx'
import { initializeConversation } from './client.js'

export function ConversationApp() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    initializeConversation().then(() => { if (active) setReady(true) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])
  if (error) return <main className="cowart-status" role="alert">{error}<button onClick={() => location.reload()} type="button">重试</button></main>
  if (!ready) return <main className="cowart-status" role="status">正在打开画板…</main>
  return <App />
}
