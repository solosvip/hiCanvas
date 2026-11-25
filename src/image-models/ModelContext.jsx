import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { imageApi } from './client.js'
const ModelContext = createContext(null)

export function ModelProvider({ children }) {
  const [config, setConfig] = useState({ models: [], activeModelId: null })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const reload = useCallback(async () => {
    setLoading(true)
    try { setConfig(await imageApi('/api/image-models')); setError('') }
    catch (error) { setError(error.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { reload() }, [reload])
  async function update(path, method, body) {
    const result = await imageApi(path, method, body)
    setConfig(result); setError('')
    return result
  }
  return <ModelContext.Provider value={{ ...config, loading, error, reload, update, open, setOpen }}>{children}</ModelContext.Provider>
}
export function useModels() { return useContext(ModelContext) }

export function ModelPicker({ disabled = false }) {
  const { models, activeModelId, loading, error, update } = useModels()
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  async function select(modelId) {
    setBusy(true)
    try { await update('/api/image-models/active', 'PUT', { modelId }); setFailure('') }
    catch (error) { setFailure(error.message) }
    finally { setBusy(false) }
  }
  return <div className="hc-model-picker">
    <ModelSelect ariaLabel="生图模型" disabled={disabled || busy || loading || !models.length} value={activeModelId || ''} onChange={select}
      options={models.map(model => ({ value: model.id, label: model.name }))} placeholder={loading ? '加载模型…' : '请添加生图模型'} />
    {(failure || error) && <p role="alert">{failure || error}</p>}
  </div>
}

export function ModelSelect({ ariaLabel, disabled = false, value, onChange, options, placeholder = '请选择' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selected = options.find(option => option.value === value)
  useEffect(() => {
    function closeOnOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        event.stopImmediatePropagation()
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  return <div className="hc-select" ref={rootRef}>
    <button aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel} className="hc-select-trigger" disabled={disabled} onClick={() => setOpen(current => !current)} type="button">
      <span>{selected?.label || placeholder}</span><ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
    </button>
    {open && <div className="hc-select-menu" role="listbox" aria-label={ariaLabel}>
      {options.map(option => <button aria-selected={option.value === value} className="hc-select-option" key={option.value} onClick={() => { onChange(option.value); setOpen(false) }} role="option" type="button">
        <Check aria-hidden="true" className={option.value === value ? 'is-visible' : ''} size={16} strokeWidth={2} /><span>{option.label}</span>
      </button>)}
    </div>}
  </div>
}
