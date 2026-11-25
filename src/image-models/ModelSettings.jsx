import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Settings2, X } from 'lucide-react'
import { TldrawUiButton, useEditor } from 'tldraw'
import { useModels, ModelPicker } from './ModelContext.jsx'
import { AIConnection } from '../ai-connection/AIConnection.jsx'
import { ModelForm } from './ModelForm.jsx'

export function SettingsPanel() {
  useEditor()
  const { models, loading, error: loadError, reload, update, open, setOpen } = useModels()
  const panelRef = useRef(null)
  const dragState = useRef(null)
  const [tab, setTab] = useState('models')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [position, setPosition] = useState(null)

  useEffect(() => {
    if (open) {
      setPosition({ x: Math.max(16, (window.innerWidth - 624) / 2), y: Math.max(16, (window.innerHeight - 560) / 2) })
    } else {
      setEditing(null)
      setError('')
    }
  }, [open])

  function beginDrag(event) {
    if (event.button !== 0 || !position) return
    dragState.current = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y }
    function move(pointerEvent) {
      const current = dragState.current
      if (!current) return
      const panel = panelRef.current
      const maxX = Math.max(16, window.innerWidth - (panel?.offsetWidth || 624) - 16)
      const maxY = Math.max(16, window.innerHeight - (panel?.offsetHeight || 560) - 16)
      setPosition({
        x: Math.min(maxX, Math.max(16, current.originX + pointerEvent.clientX - current.startX)),
        y: Math.min(maxY, Math.max(16, current.originY + pointerEvent.clientY - current.startY))
      })
    }
    function end() {
      dragState.current = null
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
    event.preventDefault()
  }

  async function remove(model) {
    if (!window.confirm(`删除模型配置“${model.name}”？已生成的图片会保留。`)) return
    setBusy(true)
    try { await update(`/api/image-models/${model.id}`, 'DELETE'); setError('') }
    catch (removeError) { setError(removeError.message) }
    finally { setBusy(false) }
  }

  const content = open && position ? (
    <div className="hc-settings-layer" onClick={event => { if (event.target === event.currentTarget && !busy) setOpen(false) }} onPointerDown={event => event.stopPropagation()}>
      <section ref={panelRef} className="hc-model-dialog" aria-labelledby="hc-model-title" aria-modal="true" role="dialog" style={{ left: `${position.x}px`, top: `${position.y}px` }}>
        <div className="hc-model-heading" onPointerDown={beginDrag}>
          <div><span className="hc-model-eyebrow">画板设置</span><h2 id="hc-model-title">设置</h2></div>
          <button aria-label="关闭设置" className="hc-model-close" disabled={busy} onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={16} strokeWidth={2} /></button>
        </div>
        <div className="hc-settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'models' : event.key === 'End' ? 'ai' : tab === 'ai' ? 'models' : 'ai'
          setTab(next)
          event.currentTarget.querySelector(next === 'ai' ? '#hc-tab-ai' : '#hc-tab-models').focus()
        }}>
          <button id="hc-tab-models" type="button" role="tab" aria-selected={tab === 'models'} tabIndex={tab === 'models' ? 0 : -1} aria-controls="hc-settings-content" onClick={() => setTab('models')}>生图模型</button>
          <button id="hc-tab-ai" type="button" role="tab" aria-selected={tab === 'ai'} tabIndex={tab === 'ai' ? 0 : -1} aria-controls="hc-settings-content" onClick={() => setTab('ai')}>AI 接入</button>
        </div>
        <div id="hc-settings-content" role="tabpanel" aria-labelledby={tab === 'ai' ? 'hc-tab-ai' : 'hc-tab-models'}>
        {tab === 'ai' ? <AIConnection /> : <>
        <p className="hc-model-help" id="hc-model-help">自行添加服务和模型。密钥只保存在本机；保存设置不会调用生图接口。</p>
        {loading ? <p role="status">加载中…</p> : loadError ? <div role="alert"><p>{loadError}</p><button onClick={reload} type="button">重新加载</button></div> : editing ?
          <ModelForm key={editing.id || 'new'} model={editing.id ? editing : null} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} /> : <>
            <div className="hc-model-section-heading"><div><span className="hc-model-eyebrow">IMAGE</span><h3>生图模型</h3></div><span className="hc-model-count">{models.length} 个</span></div>
            <ModelPicker disabled={busy} />
            {!models.length && <p>尚未添加模型。添加后即可在 AI 图片框中生成或使用参考图改图。</p>}
            <ul className="hc-model-list">{models.map(model => <li key={model.id}>
              <div className="hc-model-info"><strong>{model.name}</strong><span>{model.model}</span><small>{model.baseUrl}</small></div>
              <div className="hc-model-actions"><button disabled={busy} aria-label={`编辑模型 ${model.name}`} onClick={() => setEditing(model)} type="button">编辑</button><button disabled={busy} aria-label={`删除模型 ${model.name}`} onClick={() => remove(model)} type="button">删除</button></div>
            </li>)}</ul>
            <button className="hc-primary hc-add-model" disabled={busy} onClick={() => setEditing({})} type="button"><span>＋</span>添加模型</button>
          </>}
        {error && <p className="hc-model-error" role="alert">{error}</p>}
        </>}
        </div>
      </section>
    </div>
  ) : null

  return <>
    <TldrawUiButton aria-label="设置" className="hc-settings-button" data-testid="hicanvas.settings-button" onClick={() => setOpen(true)} title="设置" type="icon">
      <Settings2 aria-hidden="true" className="hc-settings-icon" />
    </TldrawUiButton>
    {typeof document !== 'undefined' && createPortal(content, document.body)}
  </>
}
