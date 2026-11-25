import { createCanvasStore, isCanvasSnapshot } from '../model/index.js'
import { isEqual } from '@tldraw/utils'
import { CanvasEditError } from './errors.js'
import { commandHandlers } from './commands/index.js'
import { validateRelationships } from './relationships.js'

/**
 * 在独立存储内执行一批普通数据命令；失败时丢弃存储，输入始终保持不变。
 * changes 按记录 ID 索引：added 为新记录，updated 为 [修改前, 修改后]，removed 为旧记录。
 * 快照和变化分别拷贝，调用者修改快照不会污染后续撤销所需的变化记录。
 */
export function executeCanvasCommands(snapshot, commands) {
  let store
  try {
    if (!Array.isArray(commands) || !commands.length || commands.length > 500) throw new CanvasEditError('每批需要 1 至 500 个操作。')
    if (!isCanvasSnapshot(snapshot)) throw new CanvasEditError('无效的画板快照。')
    const pages = Object.values(snapshot.store).filter(record => record?.typeName === 'page')
    if (pages.length !== 1) throw new CanvasEditError('画板必须只有一张内部画布。')
    store = createCanvasStore()
    for (const [id, record] of Object.entries(snapshot.store)) {
      if (record?.id !== id || !store.scopedTypes.document.has(record?.typeName)) throw new CanvasEditError('画板记录 ID 或类型无效。')
    }
    store.loadStoreSnapshot(structuredClone(snapshot))
    const input = structuredClone(commands)
    const changes = store.extractingChanges(() => store.atomic(() => {
      for (const command of input) {
        const handler = command && Object.hasOwn(commandHandlers, command.type) && commandHandlers[command.type]
        if (!handler) throw new CanvasEditError('未知的画板操作。')
        handler(store, command)
      }
      validateRelationships(store, pages[0].id)
    }))
    for (const [id, [before, after]] of Object.entries(changes.updated)) {
      if (isEqual(before, after)) delete changes.updated[id]
    }
    return { snapshot: structuredClone(store.getStoreSnapshot()), changes: structuredClone(changes) }
  } catch (error) {
    if (error instanceof CanvasEditError) throw error
    throw new CanvasEditError(String(error?.message || error).split('\n')[0], 'invalid-input', { cause: error })
  } finally {
    store?.dispose()
  }
}
