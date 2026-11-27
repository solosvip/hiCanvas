import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../execute.js'
import { CanvasEditError } from '../errors.js'
import { createClipboardContent } from './content.js'

export const EXTERNAL_CLIPBOARD_LIMITS = Object.freeze({
  plainBytes: 256 * 1024, htmlBytes: 1024 * 1024, jsonBytes: 4 * 1024 * 1024,
  totalBytes: 4 * 1024 * 1024, textPoints: 100000, htmlNodes: 10000,
  depth: 64, elements: 1000, jsonNodes: 100000,
})

const fail = message => { throw new CanvasEditError(message) }
const keys = (value, allowed) => {
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('外部内容包含不支持的字段。')
}

function plainData(input) {
  const queue = [[input, 0]], seen = new Set()
  let nodes = 0, bytes = 0
  while (queue.length) {
    const [value, depth] = queue.pop()
    bytes += 2
    if (++nodes > EXTERNAL_CLIPBOARD_LIMITS.jsonNodes || depth > EXTERNAL_CLIPBOARD_LIMITS.depth) fail('外部内容结构超过上限。')
    if (typeof value === 'string') {
      if (value.length > EXTERNAL_CLIPBOARD_LIMITS.jsonBytes) fail('外部内容超过大小上限。')
      bytes += new TextEncoder().encode(value).length
      if (bytes > EXTERNAL_CLIPBOARD_LIMITS.jsonBytes) fail('外部内容超过大小上限。')
      continue
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) continue
    if (!value || typeof value !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)) || seen.has(value)) fail('外部内容必须是无循环的普通数据。')
    seen.add(value)
    if (Array.isArray(value)) {
      const names = Object.getOwnPropertyNames(value)
      if (value.length > EXTERNAL_CLIPBOARD_LIMITS.jsonNodes || names.length !== value.length + 1 || names.some(key => key !== 'length' && (!/^\d+$/.test(key) || String(Number(key)) !== key || Number(key) >= value.length))) fail('外部内容数组必须连续且在结构上限内。')
    }
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !Object.hasOwn(descriptor, 'value')) fail('外部内容包含非法字段。')
      bytes += new TextEncoder().encode(key).length + 3
      if (bytes > EXTERNAL_CLIPBOARD_LIMITS.jsonBytes) fail('外部内容超过大小上限。')
      queue.push([descriptor.value, depth + 1])
      if (queue.length + nodes > EXTERNAL_CLIPBOARD_LIMITS.jsonNodes) fail('外部内容结构超过上限。')
    }
  }
  const json = JSON.stringify(input)
  if (new TextEncoder().encode(json).length > EXTERNAL_CLIPBOARD_LIMITS.jsonBytes) fail('外部内容超过大小上限。')
  return JSON.parse(json)
}

function textData(node) {
  let points = 0, text = ''
  const visit = (item, expected) => {
    keys(item, ['type', 'content', 'attrs', 'text', 'marks'])
    if (expected && item.type !== expected) fail('外部文字结构无效。')
    if (item.attrs) {
      keys(item.attrs, ['dir'])
      if (!['auto', 'ltr'].includes(item.attrs.dir)) fail('从右往左的文字需要 #150 支持。')
    }
    if (item.type === 'text') {
      keys(item, ['type', 'text', 'marks'])
      if (typeof item.text !== 'string') fail('外部文字结构无效。')
      if (/[\u0590-\u08ff\u200e\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufdff\ufe70-\ufefc]/u.test(item.text)) fail('从右往左的文字需要 #150 支持。')
      points += [...item.text].length; text += item.text
      if (points > EXTERNAL_CLIPBOARD_LIMITS.textPoints) fail('外部文字超过码点上限。')
      if (item.marks !== undefined && (!Array.isArray(item.marks) || item.marks.some(mark => !mark || Object.keys(mark).length !== 1 || !['bold', 'italic'].includes(mark.type)))) fail('这种文字格式需要 #150 支持。')
    } else if (item.type === 'hardBreak') keys(item, ['type'])
    else {
      keys(item, ['type', 'content', 'attrs'])
      if (!['doc', 'paragraph'].includes(item.type) || !Array.isArray(item.content)) fail('这种文字格式需要 #150 支持。')
      for (const child of item.content) visit(child, item.type === 'doc' ? 'paragraph' : null)
      if (item.type === 'paragraph' && item.content.some(child => !['text', 'hardBreak'].includes(child.type))) fail('外部段落结构无效。')
    }
  }
  visit(node, 'doc')
  return text.trim() ? node : null
}

function geometryData(shape) {
  keys(shape, ['geo', 'x', 'y', 'w', 'h', 'rotation', 'size', 'color', 'fill', 'dash', 'opacity'])
  if (!['rectangle', 'ellipse', 'diamond'].includes(shape.geo) || !['x', 'y', 'w', 'h', 'rotation', 'opacity'].every(key => Number.isFinite(shape[key])) || shape.w <= 0 || shape.h <= 0 || shape.opacity < 0 || shape.opacity > 1) fail('外部几何数据无效。')
  if (!['s', 'm', 'l', 'xl'].includes(shape.size) || !['black', 'white', 'red', 'blue', 'green', 'orange', 'light-red', 'light-blue'].includes(shape.color) || !['none', 'solid', 'pattern'].includes(shape.fill) || !['solid', 'dashed', 'dotted', 'draw'].includes(shape.dash)) fail('外部几何样式无效。')
  return shape
}

// This builds temporary, validated records through the ordinary commands.
// It never receives browser objects or opens a transaction on a live board.
export function createExternalClipboardContent(input) {
  input = plainData(input)
  let commands
  if (input?.type === 'text') {
    keys(input, ['type', 'richText'])
    const richText = textData(input.richText)
    if (!richText) return null
    commands = [{ type: 'create_shape', id: 'shape:external-text', shapeType: 'text', props: { richText } }]
  }
  else if (input?.type === 'excalidraw' && Array.isArray(input.shapes)) {
    keys(input, ['type', 'shapes'])
    if (input.shapes.length > EXTERNAL_CLIPBOARD_LIMITS.elements) fail('外部图形数量超过上限。')
    commands = input.shapes.flatMap((shape, i) => {
      shape = geometryData(shape)
      const id = `shape:external-${i}`
      return [{ type: 'create_shape', id, shapeType: 'geo', x: shape.x, y: shape.y, rotation: shape.rotation,
        props: { geo: shape.geo, w: shape.w, h: shape.h, size: shape.size, color: shape.color, fill: shape.fill, dash: shape.dash } },
      { type: 'update', id, changes: { opacity: shape.opacity } }]
    })
  } else throw new CanvasEditError('不支持的外部内容数据。')
  if (!commands.length) return null
  const result = executeCanvasCommands(createCanvasSnapshot(), commands)
  return createClipboardContent(result.snapshot, commands.filter(c => c.type === 'create_shape').map(c => c.id))
}
