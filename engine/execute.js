import { loadValidatedCanvasSnapshot } from './load-snapshot.js'
import { isEqual } from '@tldraw/utils'
import { CanvasEditError } from './errors.js'
import { commandHandlers } from './commands/index.js'
import { validateRelationships } from './relationships.js'
import { reconcileGroups, previousRecords } from './group-consistency.js'
import { reconcileSlides } from './slides-consistency.js'

// MCP 在自己的工具参数中限制 500 条；HTTP 请求另有 50 MB 上限，编辑器的大手势允许一次提交。
export const MAX_TRANSACTION_COMMANDS = 20000

/**
 * 在独立存储内执行一批普通数据命令；失败时丢弃存储，输入始终保持不变。
 * changes 按记录 ID 索引：added 为新记录，updated 为 [修改前, 修改后]，removed 为旧记录。
 * 快照和变化分别拷贝，调用者修改快照不会污染后续撤销所需的变化记录。
 * results 与命令逐项对应；没有回执的命令返回 null。
 */
export function executeCanvasCommands(snapshot, commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > MAX_TRANSACTION_COMMANDS) throw new CanvasEditError(`每批需要 1 至 ${MAX_TRANSACTION_COMMANDS} 个操作。`)
  return executeCanvasTransaction(snapshot, commands, { finalize: true })
}

// 仅供编辑层内部倒放已记录的事务；外部输入的命令数量限制保留在公开入口。
export function executeCanvasTransaction(snapshot, commands, { finalize = false } = {}) {
  let store
  try {
    const loaded = loadValidatedCanvasSnapshot(snapshot)
    store = loaded.store
    const input = structuredClone(commands)
    const results = []
    const journal = []
    const implicitParents = new Set()
    if (finalize) store.addHistoryInterceptor(entry => journal.push(entry.changes))
    const changes = store.extractingChanges(() => store.atomic(() => {
      for (const command of input) {
        const handler = command && Object.hasOwn(commandHandlers, command.type) && commandHandlers[command.type]
        if (!handler) throw new CanvasEditError('未知的画板操作。')
        const start = journal.length
        results.push(handler(store, command) ?? null)
        if (finalize) {
          if (command.type === 'create_shape' && !command.parentId) {
            for (const diff of journal.slice(start)) for (const id of Object.keys(diff.added)) implicitParents.add(id)
          } else {
            const explicit = command.type === 'reparent_shapes' ? command.ids : command.type === 'put' ? [command.record.id] : command.changes?.parentId ? [command.id] : []
            for (const id of explicit) implicitParents.delete(id)
            for (const diff of journal.slice(start)) for (const [id, [before, after]] of Object.entries(diff.updated)) if (before.parentId !== after.parentId) implicitParents.delete(id)
          }
        }
      }
      // 倒放历史恢复当时的原值，不再次执行组的编辑规则。
      if (finalize) {
        reconcileGroups(store, journal.flatMap(previousRecords))
        reconcileSlides(store, journal, implicitParents)
      }
      validateRelationships(store, loaded.pageId)
      // Media receipts describe the finalized placement, including reflow
      // caused by a later command in this same transaction.
      if (finalize) for (const result of results) {
        if (!result?.shapeRecord) continue
        const shape = result?.shapeId && store.get(result.shapeId)
        if (!shape) { result.shapeRecord = null; result.bounds = null; continue }
        result.shapeRecord = shape
        result.bounds = { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h }
      }
    }))
    for (const [id, [before, after]] of Object.entries(changes.updated)) {
      if (isEqual(before, after)) delete changes.updated[id]
    }
    return { snapshot: structuredClone(store.getStoreSnapshot()), changes: structuredClone(changes), results: structuredClone(results) }
  } catch (error) {
    if (error instanceof CanvasEditError) throw error
    throw new CanvasEditError(String(error?.message || error).split('\n')[0], 'invalid-input', { cause: error })
  } finally {
    store?.dispose()
  }
}
