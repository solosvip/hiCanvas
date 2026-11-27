import { EXTERNAL_CLIPBOARD_LIMITS as limits } from '../../engine/index.js'

const colors = new Map([['#1e1e1e', 'black'], ['#ffffff', 'white'], ['#e03131', 'red'], ['#1971c2', 'blue'], ['#2f9e44', 'green'], ['#f08c00', 'orange']])
const backgrounds = new Map([['#ffc9c9', 'light-red'], ['#a5d8ff', 'light-blue']])
const invalid = reason => { throw new Error(`Excalidraw 数据无效：${reason}。`) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const add = (counts, key, amount = 1) => { counts[key] = (counts[key] || 0) + amount }

export function hasClipboardType(text, type) {
  if (!text.trimStart().startsWith('{')) return false
  let depth = 0, readingKey = false, key = null, colon = false
  // Recognize a root type property even when later JSON is broken. A mention
  // of the format name in prose or a nested value is ordinary text instead.
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      const start = i++
      for (; i < text.length; i++) { if (text[i] === '\\') i++; else if (text[i] === '"') break }
      let token
      try { token = JSON.parse(text.slice(start, i + 1)) } catch { return false }
      if (depth === 1 && readingKey) { key = token; readingKey = false }
      else if (depth === 1 && colon && key === 'type') return token === type
    } else if (char === '{' || char === '[') { depth++; if (depth === 1) readingKey = true }
    else if (char === '}' || char === ']') { if (--depth === 0) return false }
    else if (depth === 1 && char === ',') { readingKey = true; key = null; colon = false }
    else if (depth === 1 && char === ':') colon = true
  }
  return false
}

function validateJson(value) {
  const stack = [[value, 0]]
  let nodes = 0
  while (stack.length) {
    const [item, depth] = stack.pop()
    if (++nodes > limits.jsonNodes || depth > limits.depth) invalid('结构超过上限')
    if (typeof item === 'number' && !Number.isFinite(item)) invalid('数值必须有限')
    if (!item || typeof item !== 'object') continue
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid('包含非法字段')
      stack.push([child, depth + 1])
      if (stack.length + nodes > limits.jsonNodes) invalid('结构超过上限')
    }
  }
}

function validateElement(element, ids) {
  if (!object(element) || typeof element.id !== 'string' || !element.id || element.id.length > 512 || ids.has(element.id)) invalid('元素编号缺失、重复或过长')
  ids.add(element.id)
  if (typeof element.type !== 'string' || !element.type || element.type.length > 64) invalid('元素类型无效')
  if (!['x', 'y', 'width', 'height', 'angle', 'strokeWidth', 'roughness', 'opacity'].every(key => Number.isFinite(element[key]))) invalid('几何或样式数值必须有限')
  if (element.width <= 0 || element.height <= 0 || element.strokeWidth <= 0 || element.roughness < 0 || element.opacity < 0 || element.opacity > 100) invalid('尺寸、线宽或透明度越界')
  if (!['strokeColor', 'backgroundColor', 'strokeStyle', 'fillStyle'].every(key => typeof element[key] === 'string' && element[key].length <= 128)) invalid('样式字段无效')
  if (element.groupIds !== undefined && (!Array.isArray(element.groupIds) || element.groupIds.some(id => typeof id !== 'string' || !id || id.length > 512))) invalid('分组引用无效')
  for (const key of ['frameId', 'link', 'fileId']) if (element[key] != null && typeof element[key] !== 'string') invalid('引用字段无效')
  for (const key of ['isDeleted', 'locked']) if (element[key] !== undefined && typeof element[key] !== 'boolean') invalid('元素状态无效')
  if (element.boundElements != null && (!Array.isArray(element.boundElements) || element.boundElements.some(binding => !object(binding) || typeof binding.id !== 'string' || !binding.id || binding.id.length > 512 || typeof binding.type !== 'string'))) invalid('绑定字段无效')
}

function convert(element, ids, counts) {
  if (element.isDeleted) { add(counts, 'deletedElements'); return null }
  if (!['rectangle', 'ellipse', 'diamond'].includes(element.type)) { add(counts, 'unsupportedTypes'); return null }
  const bindings = element.boundElements || []
  add(counts, 'droppedBindings', bindings.filter(binding => !ids.has(binding.id)).length)
  if (bindings.some(binding => ids.has(binding.id)) || element.groupIds?.length || element.frameId || element.roundness != null || element.link || element.fileId || element.locked || element.startBinding || element.endBinding || ![0, 1, 2].includes(element.roughness) || !['solid', 'dashed', 'dotted'].includes(element.strokeStyle)) {
    add(counts, 'unsupportedFeatures'); return null
  }
  const stroke = colors.get(element.strokeColor.toLowerCase())
  if (!stroke) add(counts, 'colorsToBlack')
  let color = stroke || 'black', fill = 'none'
  if (element.backgroundColor !== 'transparent') {
    const background = backgrounds.get(element.backgroundColor.toLowerCase())
    if (!background) add(counts, 'backgroundFallbacks')
    else { if (background !== color) add(counts, 'mergedColors'); color = background }
    if (['hachure', 'cross-hatch'].includes(element.fillStyle)) { fill = 'pattern'; add(counts, 'patternFills') }
    else { fill = 'solid'; if (element.fillStyle !== 'solid') add(counts, 'solidFills') }
  }
  const width = element.strokeWidth
  const size = width <= 1.5 ? 's' : width <= 2.5 ? 'm' : width <= 3.5 ? 'l' : 'xl'
  if (![1, 2, 3, 4].includes(width)) add(counts, 'binnedWidths')
  const dash = element.strokeStyle === 'solid' && element.roughness > 0 ? 'draw' : element.strokeStyle
  if (dash === 'draw') add(counts, 'roughLines')
  const rotation = ((element.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const cos = Math.cos(rotation), sin = Math.sin(rotation), w = element.width, h = element.height
  const x = element.x + w / 2 - cos * w / 2 + sin * h / 2
  const y = element.y + h / 2 - sin * w / 2 - cos * h / 2
  if (![x, y, x + w, y + h].every(Number.isFinite)) invalid('转换后的坐标越界')
  return { geo: element.type, x, y, w, h, rotation, color, fill, size, dash, opacity: element.opacity / 100 }
}

const descriptions = {
  unsupportedTypes: n => `${n} 个元素类型暂不支持，已跳过`, unsupportedFeatures: n => `${n} 个元素含暂不支持的特性，已跳过`,
  droppedBindings: n => `${n} 个缺失对象的绑定已去掉`, deletedElements: n => `${n} 个已删除元素已跳过`,
  colorsToBlack: n => `${n} 处描边颜色已换成黑色`, backgroundFallbacks: n => `${n} 处背景色已改用描边颜色`,
  mergedColors: n => `${n} 处描边与填充已合并为单色`, patternFills: n => `${n} 处填充已转成图案`, solidFills: n => `${n} 处未知填充已转成实色`,
  binnedWidths: n => `${n} 处线宽已分档`, roughLines: n => `${n} 处粗糙度已转成手绘线`, unsupportedFiles: n => `${n} 份附件暂不导入`,
}

export function parseExcalidrawClipboard(text) {
  let value
  try { value = JSON.parse(text) } catch {
    if (hasClipboardType(text, 'excalidraw/clipboard')) invalid('JSON 解析失败')
    return null
  }
  if (value?.type !== 'excalidraw/clipboard') return null
  validateJson(value)
  if (!Array.isArray(value.elements) || value.elements.length > limits.elements || value.files !== undefined && !object(value.files)) invalid('元素或文件列表无效或超过上限')
  const ids = new Set(), counts = {}
  // Validate every element before filtering anything. An unsupported element
  // cannot conceal a malformed number or duplicate ID and cause partial paste.
  for (const element of value.elements) validateElement(element, ids)
  const shapes = value.elements.map(element => convert(element, ids, counts)).filter(Boolean)
  if (value.files && Object.keys(value.files).length) add(counts, 'unsupportedFiles', Object.keys(value.files).length)
  const nonzero = Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0))
  const parts = Object.entries(nonzero).map(([key, n]) => descriptions[key](n))
  const message = [!shapes.length && '没有可导入的内容', ...parts].filter(Boolean).join('；')
  return { data: { type: 'excalidraw', shapes }, notice: message ? { source: 'clipboard', message, counts: nonzero } : null }
}
