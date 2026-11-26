import { getIndexAbove } from '@tldraw/utils'
import { toRichText } from '@tldraw/tlschema'
import { CanvasEditError } from '../errors.js'

// 沿用现有命令的 tldraw 5.1.1 默认值，不引入编辑器或形状工具。
function defaultProps(type) {
  const text = { color: 'black', size: 'm', font: 'sans', scale: 1, richText: toRichText('') }
  switch (type) {
    case 'geo': return { ...text, w: 200, h: 120, geo: 'rectangle', dash: 'solid', growY: 0, url: '', labelColor: 'black', fill: 'none', align: 'middle', verticalAlign: 'middle' }
    case 'text': return { ...text, w: 200, textAlign: 'start', autoSize: true }
    case 'arrow': return { ...text, kind: 'arc', elbowMidPoint: 0.5, dash: 'solid', fill: 'none', labelColor: 'black', bend: 0, start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'arrow', labelPosition: 0.5 }
    case 'line': return { color: 'black', size: 'm', dash: 'draw', spline: 'line', scale: 1, points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: .1, y: .1 } } }
    case 'image': return { w: 512, h: 512, assetId: null, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' }
    case 'embed': return { w: 1024, h: 576, url: '' }
    case 'frame': return { w: 1024, h: 576, name: '', color: 'black' }
    case 'group': return {}
    default: throw new CanvasEditError('这种形状需要使用 put 操作提供完整 tldraw 记录。')
  }
}

export function createShape(store, command) {
  const parentId = command.parentId || store.allRecords().find(record => record.typeName === 'page')?.id
  if (!['page', 'shape'].includes(store.get(parentId)?.typeName)) throw new CanvasEditError('找不到形状所属画布或父形状。')
  const id = command.id || `shape:${globalThis.crypto.randomUUID()}`
  if (typeof id !== 'string' || !id.startsWith('shape:') || store.has(id)) throw new CanvasEditError('形状 ID 无效或已存在。')
  const siblings = store.allRecords().filter(record => record.typeName === 'shape' && record.parentId === parentId).map(record => record.index).sort()
  const props = { ...defaultProps(command.shapeType), ...command.props }
  if (command.text !== undefined) props.richText = toRichText(String(command.text))
  store.put([{ id, typeName: 'shape', type: command.shapeType, x: command.x ?? 0, y: command.y ?? 0, rotation: command.rotation ?? 0, index: getIndexAbove(siblings.at(-1) || 'a0'), parentId, isLocked: false, opacity: 1, props, meta: command.meta || {} }])
}
