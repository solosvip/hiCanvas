import { createContext, useCallback, useContext, useEffect, useState } from 'react'
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

export function ModelPicker({ disabled = false, showSettings = true }) {
  const { models, activeModelId, loading, error, update, setOpen } = useModels()
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  async function select(event) {
    setBusy(true)
    try { await update('/api/image-models/active', 'PUT', { modelId: event.target.value }); setFailure('') }
    catch (error) { setFailure(error.message) }
    finally { setBusy(false) }
  }
  return <div className="hc-model-picker">
    <div className="hc-model-row">
      <select aria-label="生图模型" value={activeModelId || ''} disabled={disabled || busy || loading || !models.length} onChange={select}>
        {!models.length && <option value="">{loading ? '加载模型…' : '请添加生图模型'}</option>}
        {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      {showSettings && <button type="button" disabled={disabled} onClick={() => setOpen(true)}>模型设置</button>}
    </div>
    {(failure || error) && <p role="alert">{failure || error}</p>}
  </div>
}
