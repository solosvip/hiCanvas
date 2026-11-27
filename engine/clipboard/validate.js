import { createCanvasStore } from '../../model/index.js'
import { CanvasEditError } from '../errors.js'
import { validateRelationships } from '../relationships.js'
import { validateClipboardResources } from './resource-data.js'

export const CLIPBOARD_TYPE = 'hicanvas/clipboard'
export const CLIPBOARD_VERSION = 1
export const CLIPBOARD_PAGE = 'page:clipboard'
export const MAX_CLIPBOARD_RECORDS = 10000
export const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024

export function clipboardJson(value) {
  try {
    const json = JSON.stringify(value)
    if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_CLIPBOARD_BYTES) throw new Error('剪贴板内容超过大小上限。')
    return json
  } catch (error) { throw new CanvasEditError(error?.message || '剪贴板内容不是有效数据。') }
}

// Full validation, not sanitization: malformed input is rejected as a whole.
// A temporary MIT Store checks the same record schema as the paste command.
export function validateClipboardContent(value) {
  if (!value || value.type !== CLIPBOARD_TYPE || value.version !== CLIPBOARD_VERSION) throw new CanvasEditError('不支持的内部剪贴板格式。')
  for (const key of ['shapes', 'bindings', 'assets', 'rootIds', 'resources']) if (!Array.isArray(value[key])) throw new CanvasEditError('内部剪贴板列表无效。')
  validateClipboardResources(value.resources)
  const count = value.shapes.length + value.bindings.length + value.assets.length
  if (!value.shapes.length || count > MAX_CLIPBOARD_RECORDS || !value.rootIds.length || value.rootIds.length > value.shapes.length) throw new CanvasEditError('剪贴板对象数量无效或超过上限。')
  if (!value.origin || typeof value.origin.boardId !== 'string' || value.origin.boardId.length > 512 || !value.origin.parents || typeof value.origin.parents !== 'object' || Array.isArray(value.origin.parents)) throw new CanvasEditError('剪贴板来源信息无效。')
  const content = JSON.parse(clipboardJson(value)), ids = new Set(), roots = new Set(content.rootIds)
  if (roots.size !== content.rootIds.length || [...roots].some(id => typeof id !== 'string')) throw new CanvasEditError('剪贴板根对象重复或无效。')
  for (const [key, type] of [['shapes', 'shape'], ['assets', 'asset'], ['bindings', 'binding']]) for (const record of content[key]) {
    if (record?.typeName !== type || typeof record.id !== 'string' || !record.id.startsWith(`${type}:`) || ids.has(record.id)) throw new CanvasEditError('剪贴板记录类型或编号重复。')
    ids.add(record.id)
  }
  const shapes = new Map(content.shapes.map(r => [r.id, r])), assets = new Set(content.assets.map(r => r.id))
  for (const id of roots) if (!shapes.has(id) || typeof content.origin.parents[id] !== 'string') throw new CanvasEditError('剪贴板根对象不存在。')
  for (const shape of shapes.values()) {
    if (roots.has(shape.id) ? shape.parentId !== CLIPBOARD_PAGE : !shapes.has(shape.parentId)) throw new CanvasEditError('剪贴板父子引用不完整。')
    if (shape.props?.assetId && !assets.has(shape.props.assetId)) throw new CanvasEditError('剪贴板缺少所引用的资源。')
  }
  for (const binding of content.bindings) if (!shapes.has(binding.fromId) || !shapes.has(binding.toId)) throw new CanvasEditError('剪贴板绑定引用不完整。')
  const store = createCanvasStore()
  try {
    store.put([{ id: CLIPBOARD_PAGE, typeName: 'page', name: 'Clipboard', index: 'a1', meta: {} }, ...content.assets, ...content.shapes, ...content.bindings])
    validateRelationships(store, CLIPBOARD_PAGE)
  } catch (error) { throw new CanvasEditError(String(error?.message || error).split('\n')[0]) }
  finally { store.dispose() }
  return content
}
