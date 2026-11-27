import { atom } from '@tldraw/state'
import { createCanvasStore } from '../../model/index.js'
import { executeCanvasTransaction, MAX_TRANSACTION_COMMANDS } from '../execute.js'
import { CanvasEditError } from '../errors.js'
import { loadValidatedCanvasSnapshot } from '../load-snapshot.js'
import { validateRelationships } from '../relationships.js'
import { restoreCanvasRecords } from './restore.js'
import { executeLiveCommands } from './live-commands.js'
import { MAX_REPLAYS, emptyChanges, changedIds, changesToCommands, netChanges, assertUnchanged, errorData } from './changes.js'

/**
 * transport: read() → {snapshot, revision}; commit({expectedRevision,commands,actor})
 * → {revision, changes, results, snapshot?}; subscribe(onChange) → unsubscribe。
 * 可选 undo / redo({expectedRevision,actor}) 与 commit 返回相同格式；调用时才检查支持。
 * 会话应使用随机生成的标识。撤销历史由宿主保管，不在窗口中另存。
 * 广播只需通知有变化，运行时再读服务端；冲突抛 code='conflict'。
 * store 供渲染层只读挂载。手势走 preview + commitGesture；离散语义命令走 commitCommands。
 */
export async function createEditorSession({ transport, actor }) {
  if (typeof actor !== 'string' || !actor.trim() || !transport || ['read', 'commit', 'subscribe'].some(key => typeof transport[key] !== 'function')) throw new CanvasEditError('运行时需要非空操作者和读取、提交、订阅接口。')
  const store = createCanvasStore()
  const state = atom('hiCanvas editor session', Object.freeze({ revision: null, isGestureActive: false, isSubmitting: false, lastError: null }))
  let confirmed
  let pageId
  let gesture = null
  let closed = false
  let queue = Promise.resolve()
  let unsubscribe = () => {}

  function status(patch) { state.set(Object.freeze({ ...state.get(), ...patch })) }
  function open() { if (closed) throw new CanvasEditError('编辑器运行时已关闭。', 'disposed') }
  function idle() {
    open()
    if (state.get().isSubmitting) throw new CanvasEditError('编辑操作正在提交。', 'busy')
  }
  function schedule(fn) {
    const next = queue.then(() => { open(); return fn() })
    queue = next.catch(() => {})
    return next
  }
  function restore(snapshot) { restoreCanvasRecords(store, snapshot) }
  function abandon(error) {
    gesture = null
    restore(confirmed.snapshot)
    status({ isGestureActive: false, lastError: errorData(error) })
  }
  function receive(value) {
    open()
    if (typeof value?.revision !== 'string' || !value.revision) throw new CanvasEditError('服务端返回了无效版本。')
    const loaded = loadValidatedCanvasSnapshot(value.snapshot)
    let checked
    try {
      validateRelationships(loaded.store, loaded.pageId)
      checked = structuredClone(loaded.store.getStoreSnapshot())
    } finally { loaded.store.dispose() }
    let display = checked
    let conflict = null
    if (gesture && changedIds(gesture).length) {
      try {
        assertUnchanged(checked.store, gesture)
        const replay = executeCanvasTransaction(checked, changesToCommands(gesture))
        const allowed = new Set(changedIds(gesture))
        if (changedIds(replay.changes).some(id => !allowed.has(id))) throw new CanvasEditError('手势重放会连带修改别人的记录。', 'conflict')
        display = replay.snapshot
        gesture = netChanges([replay.changes])
      } catch (cause) {
        conflict = new CanvasEditError(`手势与服务端冲突：${cause.message}`, 'conflict', { cause })
        gesture = null
      }
    }
    confirmed = { snapshot: checked, revision: value.revision }
    pageId = Object.values(checked.store).find(record => record.typeName === 'page').id
    restore(display)
    status({ revision: value.revision, isGestureActive: gesture !== null, ...(conflict && { lastError: errorData(conflict) }) })
    return conflict
  }
  async function refreshNow() {
    const value = await transport.read()
    open()
    return receive(value)
  }
  function refresh() {
    return schedule(refreshNow).catch(error => { if (!closed) status({ lastError: errorData(error) }); throw error })
  }
  function beginGesture() {
    idle()
    if (gesture) throw new CanvasEditError('已有手势尚未结束。', 'busy')
    gesture = emptyChanges()
    status({ isGestureActive: true, lastError: null })
  }
  function preview(commands) {
    idle()
    if (!gesture) throw new CanvasEditError('请先开始一次手势。')
    try {
      const result = executeLiveCommands(store, pageId, commands)
      gesture = netChanges([gesture, result.changes])
      return structuredClone(result)
    } catch (error) { status({ lastError: errorData(error) }); throw error }
  }
  function cancelGesture() {
    idle()
    if (!gesture) return
    gesture = null
    restore(confirmed.snapshot)
    status({ isGestureActive: false })
  }
  async function submit() {
    try {
      if (!gesture) throw new CanvasEditError(state.get().lastError?.message || '手势已结束。', 'conflict')
      const commands = changesToCommands(gesture)
      if (!commands.length) {
        gesture = null
        status({ isGestureActive: false, lastError: null })
        return { revision: confirmed.revision, changes: emptyChanges(), results: [] }
      }
      if (commands.length > MAX_TRANSACTION_COMMANDS) throw new CanvasEditError('改动太多，无法一次提交', 'limit')
      for (let replay = 0; ; replay++) {
        try {
          const reply = await transport.commit({ expectedRevision: confirmed.revision, commands: structuredClone(commands), actor })
          open()
          const snapshot = reply.snapshot || executeCanvasTransaction(confirmed.snapshot, changesToCommands(reply.changes)).snapshot
          gesture = null
          receive({ snapshot, revision: reply.revision })
          status({ lastError: null })
          return structuredClone(reply)
        } catch (error) {
          open()
          if (error.code !== 'conflict') throw error
          const conflict = await refreshNow()
          if (conflict) throw conflict
          if (replay >= MAX_REPLAYS) throw new CanvasEditError('服务端持续变化，已达到手势重放上限。', 'conflict')
        }
      }
    } catch (error) {
      if (!closed) {
        // 网络错误可能发生在服务端已经保存之后；重新读，不盲目重复提交。
        try { const latest = await transport.read(); open(); gesture = null; receive(latest) } catch { /* 读失败时保留最后确认状态并报告原错误。 */ }
        if (!closed) abandon(error)
      }
      throw error
    } finally { if (!closed) status({ isSubmitting: false }) }
  }
  function commitGesture() {
    idle()
    if (!gesture) return Promise.reject(new CanvasEditError('没有进行中的手势。'))
    status({ isSubmitting: true })
    return schedule(submit)
  }
  function commitCommands(commands, { expectedRevision = confirmed.revision } = {}) {
    idle()
    if (gesture) throw new CanvasEditError('请先结束当前手势，再提交命令。', 'busy')
    if (expectedRevision !== confirmed.revision) throw new CanvasEditError('画板版本已变化。', 'conflict')
    if (!Array.isArray(commands) || !commands.length || commands.length > MAX_TRANSACTION_COMMANDS) throw new CanvasEditError('命令数量无效或超过上限。', 'limit')
    const input = structuredClone(commands)
    status({ isSubmitting: true, lastError: null })
    return schedule(async () => {
      try {
        if (expectedRevision !== confirmed.revision) throw new CanvasEditError('画板版本已变化。', 'conflict')
        const reply = await transport.commit({ expectedRevision, commands: input, actor })
        open()
        const snapshot = reply.snapshot || executeCanvasTransaction(confirmed.snapshot, changesToCommands(reply.changes)).snapshot
        receive({ snapshot, revision: reply.revision })
        status({ lastError: null })
        return structuredClone(reply)
      } catch (error) {
        if (!closed) {
          // 离散命令可能已保存；只刷新并报告，不重发，也不绕过版本检查。
          try { await refreshNow() } catch { /* 保留最后确认副本，报告原错误。 */ }
          if (!closed) status({ lastError: errorData(error) })
        }
        throw error
      } finally { if (!closed) status({ isSubmitting: false }) }
    })
  }
  async function moveHistory(direction) {
    idle()
    if (gesture) throw new CanvasEditError('请先结束当前手势，再撤销或重做。', 'busy')
    if (typeof transport[direction] !== 'function') {
      const error = new CanvasEditError(`宿主不支持${direction === 'undo' ? '撤销' : '重做'}。`, 'unsupported')
      status({ lastError: errorData(error) })
      throw error
    }
    status({ isSubmitting: true })
    return schedule(async () => {
      try {
        const reply = await transport[direction]({ expectedRevision: confirmed.revision, actor })
        open()
        const snapshot = reply.snapshot || executeCanvasTransaction(confirmed.snapshot, changesToCommands(reply.changes)).snapshot
        receive({ snapshot, revision: reply.revision })
        status({ lastError: null })
        return structuredClone(reply)
      } catch (error) {
        if (!closed) {
          // 回复可能丢在保存之后，版本冲突也须先刷新；均不自动重试，避免多撤一次。
          try { await refreshNow() } catch { /* 保留最后确认内容，报告原错误。 */ }
          if (!closed) status({ lastError: errorData(error) })
        }
        throw error
      } finally { if (!closed) status({ isSubmitting: false }) }
    })
  }
  function dispose() {
    if (closed) return
    closed = true
    gesture = null
    unsubscribe()
    store.dispose()
  }
  try {
    unsubscribe = transport.subscribe(() => { void refresh().catch(() => {}) })
    await refresh()
  } catch (error) { dispose(); throw error }
  return { store, state, beginGesture, preview, cancelGesture, commitGesture, commitCommands, undo: () => moveHistory('undo'), redo: () => moveHistory('redo'), refresh, dispose }
}
