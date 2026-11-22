import { inputError } from './image-models.mjs'
const IMAGE_LIMIT = 20 * 1024 * 1024

export function decodeImage(base64) {
  if (typeof base64 !== 'string' || base64.length > IMAGE_LIMIT * 1.4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw inputError('图片内容无效或超过 20 MB。')
  return imageBytes(Buffer.from(base64, 'base64'))
}
function imageBytes(bytes) {
  if (bytes.length > IMAGE_LIMIT) throw inputError('图片超过 20 MB。')
  let mimeType, extension
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { mimeType = 'image/png'; extension = 'png' }
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) { mimeType = 'image/jpeg'; extension = 'jpg' }
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') { mimeType = 'image/webp'; extension = 'webp' }
  else throw inputError('服务未返回支持的 PNG、JPEG 或 WebP 图片。', 502)
  return { bytes, mimeType, extension }
}
export function decodeReference(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/s)
  if (!match) throw inputError('参考图请使用 PNG、JPEG 或 WebP。')
  return decodeImage(match[2])
}
async function limitedBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw inputError('服务返回内容过大。', 502) }
  const chunks = []; let length = 0
  for await (const chunk of response.body || []) {
    length += chunk.length
    if (length > maxBytes) throw inputError('服务返回内容过大。', 502)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function jsonRequest(url, options, signal) {
  const response = await fetch(url, { ...options, signal, redirect: 'error' })
  if (!response.ok) {
    await response.body?.cancel()
    // 不回显供应商原始响应，避免其把 Authorization、地址参数或参考图带回界面/日志。
    const advice = response.status === 401 || response.status === 403 ? '请检查密钥和模型权限。' : response.status === 429 ? '请检查额度或请求频率。' : '请检查接口格式、地址及模型是否支持图片。'
    throw inputError(`生图服务返回 HTTP ${response.status}。${advice} 未自动重试。`, 502)
  }
  try { return JSON.parse((await limitedBytes(response, IMAGE_LIMIT * 2)).toString()) }
  catch (error) { if (error.status) throw error; throw inputError('生图服务返回的内容不是有效 JSON。', 502) }
}
async function downloadImage(src, signal) {
  let url
  try { url = new URL(src) } catch { throw inputError('服务返回的图片地址无效。', 502) }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw inputError('服务返回了不安全的图片地址。', 502)
  // 图片地址通常是独立 CDN；绝不附带模型服务的密钥，也不跟随重定向。
  const response = await fetch(url, { signal, redirect: 'error' })
  if (!response.ok) { await response.body?.cancel(); throw inputError('生成已返回，但下载图片失败；未重新请求生图。', 502) }
  return imageBytes(await limitedBytes(response, IMAGE_LIMIT))
}

export async function requestImages(model, { prompt, references = [] }) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) throw inputError('请输入图片描述（最多 32000 字符）。')
  if (!Array.isArray(references) || references.length > 10) throw inputError('最多支持 10 张参考图。')
  const images = references.map(decodeReference)
  const signal = AbortSignal.timeout(300000)
  try {
    if (model.protocol === 'gemini') {
      const parts = [{ text: prompt.trim() }, ...images.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.bytes.toString('base64') } }))]
      const name = encodeURIComponent(model.model.replace(/^models\//, ''))
      const result = await jsonRequest(`${model.baseUrl}/models/${name}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(model.apiKey ? { 'x-goog-api-key': model.apiKey } : {}) },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
      }, signal)
      const output = (result.candidates || []).flatMap(candidate => candidate.content?.parts || []).filter(part => part.inlineData && !part.thought)
      if (!output.length || output.length > 4) throw inputError('服务没有返回图片，请检查所选模型是否支持生图或提示词是否被拦截。', 502)
      return output.map(part => decodeImage(part.inlineData.data))
    }
    const headers = model.apiKey ? { authorization: `Bearer ${model.apiKey}` } : {}
    let body, path
    if (images.length) {
      body = new FormData(); body.set('model', model.model); body.set('prompt', prompt.trim()); body.set('n', '1')
      images.forEach((image, index) => body.append('image[]', new Blob([image.bytes], { type: image.mimeType }), `reference-${index + 1}.${image.extension}`))
      path = '/images/edits'
    } else {
      headers['content-type'] = 'application/json'
      body = JSON.stringify({ model: model.model, prompt: prompt.trim(), n: 1 }); path = '/images/generations'
    }
    const result = await jsonRequest(model.baseUrl + path, { method: 'POST', headers, body }, signal)
    if (!Array.isArray(result.data) || !result.data.length || result.data.length > 4) throw inputError('服务没有返回图片，或返回数量超过本次支持范围。', 502)
    const output = []
    for (const image of result.data) output.push(image.b64_json ? decodeImage(image.b64_json) : await downloadImage(image.url, signal))
    return output
  } catch (error) {
    if (error.status) throw error
    if (signal.aborted) throw inputError('等待生图超时。请求可能已计费；请先检查服务商记录，未自动重试。', 504)
    throw inputError('无法连接生图服务或下载结果。请检查地址和网络；请求可能已计费，未自动重试。', 502)
  }
}
