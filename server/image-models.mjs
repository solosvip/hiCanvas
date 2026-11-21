import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export function validateBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw inputError('API 地址格式或长度不正确。')
  let url
  try { url = new URL(value) } catch { throw inputError('请填写有效的 API 基础地址。') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw inputError('远程 API 请使用 HTTPS；本机接口可以使用 HTTP。')
  if (url.username || url.password || url.search || url.hash) throw inputError('地址不能包含账号、密钥、查询参数或片段。密钥请填在专用输入框。')
  return url.href.replace(/\/+$/, '')
}

function textField(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw inputError(`${label}不能为空，且长度不能超过 ${max} 个字符。`)
  return value.trim()
}

export function createModelStore(settingsDir) {
  const path = join(settingsDir, 'image-models.json')
  let queue = Promise.resolve()
  async function read() {
    try {
      const state = JSON.parse(await readFile(path, 'utf8'))
      if (state.version !== 1 || !Array.isArray(state.models) || state.models.some(model => !model.id || !model.model)) throw new Error()
      return state
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, models: [], activeModelId: null }
      throw inputError('无法读取模型设置，已保留原文件。请检查本机设置文件。', 500)
    }
  }
  function publicState(state) {
    return { activeModelId: state.activeModelId, models: state.models.map(({ apiKey, ...model }) => ({ ...model, hasApiKey: Boolean(apiKey) })) }
  }
  function mutate(change) {
    const result = queue.then(async () => {
      const state = await read()
      change(state)
      await mkdir(settingsDir, { recursive: true, mode: 0o700 })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
      return publicState(state)
    })
    queue = result.catch(() => {})
    return result
  }
  return {
    async list() { await queue; return publicState(await read()) },
    async get(id) {
      await queue
      const state = await read()
      const model = state.models.find(model => model.id === (id || state.activeModelId))
      if (!model) throw inputError('请先在“模型设置”中添加并选择生图模型。')
      return model
    },
    save(body, id) {
      return mutate(state => {
        const previous = id ? state.models.find(model => model.id === id) : null
        if (id && !previous) throw inputError('此模型已被删除，请重新加载设置。', 404)
        if (body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean') throw inputError('清除密钥必须明确勾选。')
        const baseUrl = validateBaseUrl(body.baseUrl)
        const protocol = body.protocol
        if (!['openai-images', 'gemini'].includes(protocol)) throw inputError('不支持此接口格式。')
        if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw inputError('密钥必须是文本。')
        const newKey = body.apiKey?.trim()
        if (newKey?.length > 8192 || /[\r\n]/.test(newKey || '')) throw inputError('密钥格式不正确。')
        if (previous?.apiKey && (baseUrl !== previous.baseUrl || protocol !== previous.protocol) && !newKey && !body.clearApiKey) throw inputError('更换地址或接口格式时，请重新填写密钥，或明确清除旧密钥。')
        const model = {
          id: previous?.id || randomUUID(), name: textField(body.name, '名称', 80), protocol, baseUrl,
          model: textField(body.model, '模型名'),
          apiKey: body.clearApiKey ? '' : (newKey || previous?.apiKey || '')
        }
        if (previous) state.models[state.models.indexOf(previous)] = model
        else state.models.push(model)
        state.activeModelId ||= model.id
      })
    },
    remove(id) { return mutate(state => {
      if (!state.models.some(model => model.id === id)) throw inputError('模型不存在。', 404)
      state.models = state.models.filter(model => model.id !== id)
      if (state.activeModelId === id) state.activeModelId = state.models[0]?.id || null
    }) },
    activate(id) { return mutate(state => {
      if (!state.models.some(model => model.id === id)) throw inputError('模型不存在。', 404)
      state.activeModelId = id
    }) }
  }
}
