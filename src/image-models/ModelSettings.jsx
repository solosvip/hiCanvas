import { useEffect, useRef, useState } from 'react'
import { TldrawUiButton, useEditor } from 'tldraw'
import { Settings2 } from 'lucide-react'
import { useModels, ModelPicker } from './ModelContext.jsx'
import { ModelForm } from './ModelForm.jsx'
import { imageApi } from './client.js'
import { insertGeneratedImages } from './canvasImages.js'

export function SettingsPanel() {
  const editor = useEditor()
  const { models, loading, error: loadError, reload, update, open, setOpen } = useModels()
  const dialog = useRef(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState([])
  useEffect(() => {
    if (open) {
      dialog.current?.showModal()
      imageApi('/api/images/results').then(data => setResults(data.images)).catch(error => setError(error.message))
    } else { dialog.current?.close(); setEditing(null); setError('') }
  }, [open])
  async function remove(model) {
    if (!window.confirm(`删除模型配置“${model.name}”？已生成的图片会保留。`)) return
    setBusy(true)
    try { await update(`/api/image-models/${model.id}`, 'DELETE'); setError('') }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  async function insert(image) {
    setBusy(true)
    try { await insertGeneratedImages(editor, [image]); setOpen(false) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  return <>
    <TldrawUiButton
      aria-label="设置"
      className="hc-settings-button"
      data-testid="hicanvas.settings-button"
      onClick={() => setOpen(true)}
      title="设置"
      type="icon"
    >
      <Settings2 aria-hidden="true" className="hc-settings-icon" />
    </TldrawUiButton>
    <dialog ref={dialog} className="hc-model-dialog" aria-labelledby="hc-model-title" onCancel={event => { event.preventDefault(); if (!busy) setOpen(false) }}
      onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="hc-model-heading"><h2 id="hc-model-title">设置</h2><button type="button" aria-label="关闭设置" disabled={busy} onClick={() => setOpen(false)}>关闭</button></div>
      <p className="hc-model-help">自行添加服务和模型。密钥只保存在本机；保存设置不会调用生图接口。</p>
      {loading ? <p role="status">加载中…</p> : loadError ? <div role="alert"><p>{loadError}</p><button onClick={reload}>重新加载</button></div> : editing ?
        <ModelForm key={editing.id || 'new'} model={editing.id ? editing : null} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} /> : <>
          <h3>生图模型</h3>
          <ModelPicker disabled={busy} />
          {!models.length && <p>尚未添加模型。添加后即可在 AI 图片框中生成或使用参考图改图。</p>}
          <ul className="hc-model-list">{models.map(model => <li key={model.id}>
            <div><strong>{model.name}</strong><span>{model.model}</span><small>{model.baseUrl}</small></div>
            <div className="hc-model-actions"><button disabled={busy} aria-label={`编辑模型 ${model.name}`} onClick={() => setEditing(model)}>编辑</button><button disabled={busy} aria-label={`删除模型 ${model.name}`} onClick={() => remove(model)}>删除</button></div>
          </li>)}</ul>
          <button className="hc-primary" disabled={busy} onClick={() => setEditing({})}>添加模型</button>
        </>}
      {error && <p className="hc-model-error" role="alert">{error}</p>}
      {!editing && results.length > 0 && <section className="hc-model-results"><h3>最近生成</h3><p>结果已保存在本机。未放入画板的图片可以从这里找回。</p><ul>{results.map(image => <li key={image.src}><a href={image.src} target="_blank" rel="noreferrer"><img src={image.src} alt="已生成的图片" /></a><button disabled={busy} onClick={() => insert(image)}>放入当前页</button><a href={image.src} download>下载</a></li>)}</ul></section>}
    </dialog>
  </>
}
