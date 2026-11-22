import React from 'react'
import { createRoot } from 'react-dom/client'
import { ModelProvider } from './image-models/ModelContext.jsx'
import App from './editor/App.jsx'
import 'tldraw/tldraw.css'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode><ModelProvider><App /></ModelProvider></React.StrictMode>
)
