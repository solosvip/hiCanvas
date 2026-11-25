import { reverseRecordsDiff } from '@tldraw/store'
import { MAX_TRANSACTION_COMMANDS } from '../execute.js'
import { CanvasEditError } from '../errors.js'
import { commandHandlers } from '../commands/index.js'
import { validateRelationships } from '../relationships.js'
import { netChanges } from './changes.js'
import { reconcileGroups, previousRecords } from '../group-consistency.js'

/**
 * Store.atomic 只负责批处理；这里在同一批次内明确倒放失败帧。
 * bulk put 拆成单条 Store.put：每个已写值都有差异日志，后条校验失败也能完整回滚。
 * 不复制文档；日志、命令和返回值只包含本帧碰过的数据。
 */
export function executeLiveCommands(store, pageId, commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > MAX_TRANSACTION_COMMANDS) throw new CanvasEditError(`每批需要 1 至 ${MAX_TRANSACTION_COMMANDS} 个操作。`)
  const input = structuredClone(commands)
  const commandStore = new Proxy(store, {
    get(target, key) {
      if (key === 'put') return records => { for (const record of records) target.put([record]) }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const results = []
  let failure
  const changes = store.extractingChanges(() => store.atomic(() => {
    const journal = []
    const stop = store.addHistoryInterceptor(entry => journal.push(entry.changes))
    try {
      for (const command of input) {
        const handler = command && Object.hasOwn(commandHandlers, command.type) && commandHandlers[command.type]
        if (!handler) throw new CanvasEditError('未知的画板操作。')
        results.push(handler(commandStore, command) ?? null)
      }
      reconcileGroups(commandStore, journal.flatMap(previousRecords))
      validateRelationships(store, pageId)
    } catch (error) {
      stop()
      store.applyDiff(reverseRecordsDiff(netChanges(journal)), { runCallbacks: false })
      failure = error
    } finally { stop() }
  }, false))
  if (failure) {
    if (failure instanceof CanvasEditError) throw failure
    throw new CanvasEditError(String(failure.message || failure).split('\n')[0], 'invalid-input', { cause: failure })
  }
  return { changes: structuredClone(netChanges([changes])), results: structuredClone(results) }
}
