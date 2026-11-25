import React from 'react'
import { createRoot } from 'react-dom/client'
import { ModelProvider } from './image-models/ModelContext.jsx'
import { ConversationApp } from './conversations/ConversationApp.jsx'
import 'tldraw/tldraw.css'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode><ModelProvider><ConversationApp /></ModelProvider></React.StrictMode>
)
