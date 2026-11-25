import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Images, X } from 'lucide-react'
import { TldrawUiButton, useEditor } from 'tldraw'
import { imageApi } from '../image-models/client.js'
import { insertGeneratedImages } from '../image-models/canvasImages.js'

export function ImageResults() {
  const editor = useEditor()
  const dialog = useRef(null)
  const [open, setOpen] = useState(false)
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) { dialog.current?.close(); return }
    dialog.current?.showModal()
    let active = true
    setLoading(true); setError('')
    imageApi('/api/images/results').then(data => { if (active) setImages(data.images) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open])
  async function insert(image) {
    setBusy(true); setError('')
    try { await insertGeneratedImages(editor, [image]); setOpen(false) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <>
    <TldrawUiButton aria-label="本画板的图片结果" title="图片结果" type="icon" onClick={() => setOpen(true)}><Images className="hc-settings-icon" aria-hidden="true" /></TldrawUiButton>
    {createPortal(<dialog className="hc-conversation-dialog hc-model-dialog" ref={dialog} aria-labelledby="hc-image-results-title" onCancel={event => { if (busy) event.preventDefault(); else setOpen(false) }} onClose={() => setOpen(false)}>
      <div className="hc-model-heading"><div><span className="hc-model-eyebrow">当前画板</span><h2 id="hc-image-results-title">图片结果</h2></div><button type="button" className="hc-model-close" aria-label="关闭图片结果" disabled={busy} onClick={() => setOpen(false)}><X className="hc-settings-icon" aria-hidden="true" /></button></div>
      <p>生成的图片会保存在这里，插入失败也可以找回。</p>
      {loading ? <p role="status">正在读取图片…</p> : !error && !images.length ? <p>还没有生成图片。</p> : null}
      {error && <p role="alert" className="hc-model-error">{error}</p>}
      <div className="hc-image-results">{images.map(image => <article key={image.src}><img src={image.src} alt="生成的图片" loading="lazy" /><div className="hc-model-actions"><button type="button" disabled={busy} onClick={() => insert(image)}>放入画板</button><a download href={image.src}>下载</a></div></article>)}</div>
    </dialog>, document.body)}
  </>
}
