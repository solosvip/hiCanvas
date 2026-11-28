import { CanvasEditError } from './errors.js'
import { MAX_TRANSACTION_COMMANDS } from './execute.js'
import { isSlidesContainer } from './slides-layout.js'

// Semantic read dependencies live here, not in the dialog or HTTP adapters.
export function getRecordDependencies(snapshot, commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > MAX_TRANSACTION_COMMANDS || commands.some(command => !['insert_url', 'convert_url_shape', 'set_image_alt_text', 'set_shape_link'].includes(command?.type))) throw new CanvasEditError('此命令尚不支持记录前置条件。', 'unsupported-record-basis')
  const ids = new Set(), memberships = new Map()
  const values = Object.values(snapshot.store)
  for (const command of commands) {
    if (command.type === 'insert_url') {
      if (snapshot.store[command.pageId]?.typeName !== 'page') throw new CanvasEditError('网址插入需要明确的目标画布。', 'conflict')
      ids.add(command.pageId)
      if (command.id !== undefined) {
        if (typeof command.id !== 'string' || !command.id.startsWith('shape:')) throw new CanvasEditError('新对象编号无效。')
        ids.add(command.id)
      }
      continue
    }
    let record = snapshot.store[command.id]
    if (record?.typeName !== 'shape') throw new CanvasEditError('目标记录已失效。', 'conflict')
    if (command.type === 'convert_url_shape' && record.type === 'bookmark' && record.props.assetId) {
      const id = record.props.assetId
      memberships.set(`asset-users:${id}`, { kind: 'asset-users', id })
    }
    const seen = new Set()
    while (record?.typeName === 'shape') {
      if (seen.has(record.id)) throw new CanvasEditError('目标祖先形成循环。', 'conflict')
      seen.add(record.id); ids.add(record.id)
      if (isSlidesContainer(record)) {
        memberships.set(`children:${record.id}`, { kind: 'children', id: record.id })
        for (const child of values) if (child.typeName === 'shape' && child.parentId === record.id) ids.add(child.id)
      }
      if (record.props.assetId) ids.add(record.props.assetId)
      record = snapshot.store[record.parentId]
    }
    if (record?.typeName !== 'page') throw new CanvasEditError('目标所属画布已失效。', 'conflict')
    ids.add(record.id)
  }
  return { ids: [...ids].sort(), memberships: [...memberships.values()], commandBytes: new TextEncoder().encode(JSON.stringify(commands)).length }
}
