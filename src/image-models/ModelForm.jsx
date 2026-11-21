import { useState } from 'react'
import { useModels } from './ModelContext.jsx'

export function ModelForm({ model, onSaved, onCancel }) {
  const { update } = useModels()
  const [form, setForm] = useState({ name: model?.name || '', protocol: model?.protocol || 'openai-images', baseUrl: model?.baseUrl || '', model: model?.model || '', apiKey: '', clearApiKey: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function field(name) { return { value: form[name], onChange: event => setForm(current => ({ ...current, [name]: event.target.value })) } }
  async function save(event) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      await update(`/api/image-models${model ? '/' + model.id : ''}`, model ? 'PUT' : 'POST', form)
      setForm(current => ({ ...current, apiKey: '' })); onSaved()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  return <form className="hc-model-form" onSubmit={save}>
    <h3>{model ? '编辑模型' : '添加模型'}</h3>
    <fieldset disabled={busy}>
      <label>显示名称<input required maxLength={80} autoFocus {...field('name')} placeholder="给这组配置起个名字" /></label>
      <label>接口格式<select {...field('protocol')}><option value="openai-images">OpenAI Images 兼容</option><option value="gemini">Gemini generateContent</option></select></label>
      <label>API 基础地址<input required type="url" maxLength={2048} {...field('baseUrl')} placeholder="填写服务商提供的基础地址" aria-describedby="hc-api-help" /></label>
      <p id="hc-api-help">{form.protocol === 'gemini' ? '通常以 /v1beta 结尾。自动追加 /models/模型名:generateContent。' : '通常以 /v1 结尾。自动追加 /images/generations 或 /images/edits。'}</p>
      <label>模型名<input required maxLength={256} {...field('model')} placeholder="填写服务商给出的模型标识，不限预设列表" /></label>
      <label>API 密钥<input type="password" autoComplete="new-password" maxLength={8192} {...field('apiKey')} placeholder={model?.hasApiKey ? '已保存；留空保留原密钥' : '填写密钥；无鉴权的本机接口可留空'} /></label>
      {model?.hasApiKey && <label className="hc-model-check"><input type="checkbox" checked={form.clearApiKey} onChange={event => setForm(current => ({ ...current, clearApiKey: event.target.checked, apiKey: '' }))} />清除已保存的密钥</label>}
    </fieldset>
    {error && <p className="hc-model-error" role="alert">{error}</p>}
    <div className="hc-model-actions"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button className="hc-primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存模型'}</button></div>
  </form>
}
