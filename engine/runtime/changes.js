import { isEqual } from '@tldraw/utils'
import { squashRecordDiffs } from '@tldraw/store'
import { CanvasEditError } from '../errors.js'

export const MAX_REPLAYS = 2
export const emptyChanges = () => ({ added: {}, updated: {}, removed: {} })
export const changedIds = changes => [...Object.keys(changes.added), ...Object.keys(changes.updated), ...Object.keys(changes.removed)]

export function netChanges(diffs) {
  const changes = squashRecordDiffs(diffs)
  for (const [id, [before, after]] of Object.entries(changes.updated)) if (isEqual(before, after)) delete changes.updated[id]
  return changes
}

export function changesToCommands(changes) {
  const commands = [...Object.values(changes.added), ...Object.values(changes.updated).map(([, after]) => after)].map(record => ({ type: 'put', record }))
  const ids = Object.keys(changes.removed)
  if (ids.length) commands.push({ type: 'delete', ids })
  return commands
}

// 按整条记录判断重叠；本来不存在的 ID 被创建也属于冲突。
export function assertUnchanged(records, changes) {
  for (const id of Object.keys(changes.added)) if (Object.hasOwn(records, id)) throw new CanvasEditError(`记录 ${id} 已被别人创建。`, 'conflict')
  for (const [id, before] of [...Object.entries(changes.removed), ...Object.entries(changes.updated).map(([id, [before]]) => [id, before])]) {
    if (!isEqual(records[id], before)) throw new CanvasEditError(`记录 ${id} 已被别人修改或删除。`, 'conflict')
  }
}

export function errorData(error) {
  return Object.freeze({ code: error.code || 'error', message: String(error.message || error).split('\n')[0] })
}
