import { documentRecordTypes } from './canvas-documents.mjs'
import { randomUUID } from 'node:crypto'
import { getIndexAbove, toRichText } from 'tldraw'
import { httpError } from './file-lock.mjs'

// 与锁定的 tldraw 5.1.1 文档格式一致；最后仍经同一个 schema 完整校验。
function defaultProps(type) {
  const text = { color: 'black', size: 'm', font: 'sans', scale: 1, richText: toRichText('') }
  switch (type) {
    case 'geo': return { ...text, w: 200, h: 120, geo: 'rectangle', dash: 'solid', growY: 0, url: '', labelColor: 'black', fill: 'none', align: 'middle', verticalAlign: 'middle' }
    case 'text': return { ...text, w: 200, textAlign: 'start', autoSize: true }
    case 'arrow': return { ...text, kind: 'arc', elbowMidPoint: 0.5, dash: 'solid', fill: 'none', labelColor: 'black', bend: 0, start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'arrow', labelPosition: 0.5 }
    case 'image': return { w: 512, h: 512, assetId: null, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' }
    case 'embed': return { w: 1024, h: 576, url: '' }
    case 'frame': return { w: 1024, h: 576, name: '' }
    case 'group': return {}
    default: throw httpError('这种形状需要使用 put 操作提供完整 tldraw 记录。')
  }
}
function validRecord(record) {
  if (!record || !documentRecordTypes.has(record.typeName) || typeof record.id !== 'string') throw httpError('只允许写入有效的画板文档记录。')
}

export function applyCanvasOperations(snapshot, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 500) throw httpError('每批需要 1 至 500 个操作。')
  const store = snapshot.store
  for (const op of operations) {
    if (!op || typeof op !== 'object') throw httpError('无效的画板操作。')
    if (op.type === 'put') {
      validRecord(op.record)
      store[op.record.id] = op.record
    } else if (op.type === 'create_shape') {
      const parentId = op.parentId || Object.values(store).find(r => r.typeName === 'page')?.id
      if (!store[parentId] || !['page', 'shape'].includes(store[parentId].typeName)) throw httpError('找不到形状所属页面或父形状。')
      const id = op.id || `shape:${randomUUID()}`
      if (!id.startsWith('shape:') || store[id]) throw httpError('形状 ID 无效或已存在。')
      const siblings = Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === parentId).map(r => r.index).sort()
      const props = { ...defaultProps(op.shapeType), ...op.props }
      if (op.text !== undefined) props.richText = toRichText(String(op.text))
      store[id] = { id, typeName: 'shape', type: op.shapeType, x: op.x ?? 0, y: op.y ?? 0, rotation: op.rotation ?? 0, index: getIndexAbove(siblings.at(-1) || 'a0'), parentId, isLocked: false, opacity: 1, props, meta: op.meta || {} }
    } else if (op.type === 'update') {
      const previous = store[op.id]
      if (!previous) throw httpError(`找不到记录：${op.id}`)
      const changes = op.changes
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.hasOwn(changes, 'id') || Object.hasOwn(changes, 'typeName') || Object.hasOwn(changes, 'type')) throw httpError('更新不能更改记录 ID 或类型。')
      store[op.id] = { ...previous, ...changes, ...(changes.props && { props: { ...previous.props, ...changes.props } }), ...(changes.meta && { meta: { ...previous.meta, ...changes.meta } }) }
    } else if (op.type === 'delete') {
      if (!Array.isArray(op.ids) || op.ids.some(id => typeof id !== 'string' || !store[id])) throw httpError('要删除的记录不存在。')
      const ids = new Set(op.ids)
      let expanded = true
      while (expanded) {
        expanded = false
        for (const r of Object.values(store)) {
          if (!ids.has(r.id) && (ids.has(r.parentId) || (r.typeName === 'binding' && (ids.has(r.fromId) || ids.has(r.toId))))) { ids.add(r.id); expanded = true }
        }
      }
      for (const id of ids) delete store[id]
    } else throw httpError('未知的画板操作。')
  }
  return snapshot
}
