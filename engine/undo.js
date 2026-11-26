import { isEqual } from '@tldraw/utils'
import { CanvasEditError } from './errors.js'
import { executeCanvasTransaction } from './execute.js'

const HISTORY_LIMIT = 100

function invalid(message) {
  throw new CanvasEditError(message)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function copyJson(value) {
  try {
    const copy = JSON.parse(JSON.stringify(value))
    if (!isEqual(value, copy)) invalid('撤销记录只能包含可完整保存的 JSON 数据。')
    return copy
  } catch (cause) {
    if (cause instanceof CanvasEditError) throw cause
    throw new CanvasEditError('撤销记录只能包含可完整保存的 JSON 数据。', 'invalid-input', { cause })
  }
}

function validateActor(actor) {
  if (typeof actor !== 'string') invalid('操作者必须是字符串。')
}

function validateChanges(changes) {
  const seen = new Set()
  for (const kind of ['added', 'updated', 'removed']) {
    if (!object(changes) || !object(changes[kind])) invalid('事务需要 added、updated、removed 三组变化。')
    for (const [id, value] of Object.entries(changes[kind])) {
      if (seen.has(id)) invalid('同一记录不能出现在多组变化中。')
      seen.add(id)
      const records = kind === 'updated' ? value : [value]
      if (!Array.isArray(records) || records.length !== (kind === 'updated' ? 2 : 1)) invalid('更新记录需要修改前、修改后两个值。')
      if (records.some(record => !object(record) || record.id !== id || typeof record.typeName !== 'string')) invalid('变化中的记录必须与其 ID 一致。')
      if (kind === 'updated' && isEqual(records[0], records[1])) invalid('更新变化必须包含实际改动。')
    }
  }
}

function copyHistory(history) {
  const next = copyJson(history ?? { actors: [] })
  if (!object(next) || !Array.isArray(next.actors)) invalid('撤销记录需要操作者列表。')
  const actors = new Set()
  for (const entry of next.actors) {
    if (!object(entry)) invalid('操作者的撤销记录无效。')
    validateActor(entry.actor)
    if (actors.has(entry.actor)) invalid('操作者的撤销记录不能重复。')
    actors.add(entry.actor)
    if (!Array.isArray(entry.undo) || !Array.isArray(entry.redo) || entry.undo.length + entry.redo.length > HISTORY_LIMIT) invalid('操作者的撤销记录数量无效。')
    for (const changes of [...entry.undo, ...entry.redo]) {
      validateChanges(changes)
      if (!changedIds(changes).length) invalid('撤销记录不能包含空事务。')
    }
  }
  return next
}

function changedIds(changes) {
  return [...Object.keys(changes.added), ...Object.keys(changes.updated), ...Object.keys(changes.removed)]
}

/**
 * 只记调用方实际保存的变化；不读取或重算画板。首次传入 undefined 历史即可。
 * 历史格式为 { actors: [{ actor, undo: [changes], redo: [changes] }] }，栈尾为最近事务。
 * redo 存的是撤销实际产生的 changes，重做时将它倒放。空变化不算新编辑。
 */
export function recordCanvasTransaction(history, actor, changes) {
  validateActor(actor)
  const next = copyHistory(history)
  const transaction = copyJson(changes)
  validateChanges(transaction)
  if (!changedIds(transaction).length) return next
  let entry = next.actors.find(item => item.actor === actor)
  if (!entry) {
    entry = { actor, undo: [], redo: [] }
    next.actors.push(entry)
  }
  entry.undo.push(transaction)
  entry.undo = entry.undo.slice(-HISTORY_LIMIT)
  entry.redo = []
  return next
}

function assertCurrent(store, changes) {
  if (!object(store)) invalid('当前画板快照无效。')
  for (const [id, record] of Object.entries(changes.added)) {
    if (!Object.hasOwn(store, id) || !isEqual(store[id], record)) invalid(`记录 ${id} 在事务后被修改或删除。`)
  }
  for (const [id, [, record]] of Object.entries(changes.updated)) {
    if (!Object.hasOwn(store, id) || !isEqual(store[id], record)) invalid(`记录 ${id} 在事务后被修改或删除。`)
  }
  for (const id of Object.keys(changes.removed)) {
    if (Object.hasOwn(store, id)) invalid(`已删除的记录 ${id} 又被创建。`)
  }
}

function assertRestoredIndices(store, changes, allowed) {
  const outside = new Map()
  for (const record of Object.values(store)) {
    if (record.typeName !== 'shape' || allowed.has(record.id)) continue
    if (!outside.has(record.parentId)) outside.set(record.parentId, new Map())
    outside.get(record.parentId).set(record.index, record.id)
  }
  const restored = [...Object.values(changes.removed), ...Object.values(changes.updated).map(([before]) => before)]
  for (const record of restored) {
    if (record.typeName !== 'shape') continue
    const otherId = outside.get(record.parentId)?.get(record.index)
    if (otherId) invalid(`记录 ${record.id} 要恢复的层级索引已被同级记录 ${otherId} 占用。`)
  }
}

function invert(snapshot, changes) {
  assertCurrent(snapshot?.store, changes)
  // Remove explicit bindings before replaying exact arrow records. Otherwise
  // deleting their targets would re-freeze terminals and alter replayed values.
  const ids = Object.keys(changes.added), bindings = ids.filter(id => snapshot.store[id]?.typeName === 'binding')
  // Restore shapes before deleting containers, so surviving children escape
  // cascade deletion. Relations are validated only after the whole batch.
  const commands = [
    ...(bindings.length ? [{ type: 'delete', ids: bindings }] : []),
    ...Object.values(changes.removed).map(record => ({ type: 'put', record })),
    ...Object.values(changes.updated).map(([record]) => ({ type: 'put', record })),
  ]
  const remaining = ids.filter(id => !bindings.includes(id))
  if (remaining.length) commands.push({ type: 'delete', ids: remaining })
  const result = executeCanvasTransaction(snapshot, commands)
  const allowed = new Set(changedIds(changes))
  if (changedIds(result.changes).some(id => !allowed.has(id))) invalid('倒放事务会连带修改或删除其他事务的记录。')
  // 同时确认原事务的每条记录都准确回到旧值，防止级联删除波及应恢复的记录。
  assertCurrent(result.snapshot.store, {
    added: changes.removed,
    updated: Object.fromEntries(Object.entries(changes.updated).map(([id, [before, after]]) => [id, [after, before]])),
    removed: changes.added,
  })
  assertRestoredIndices(result.snapshot.store, changes, allowed)
  return result
}

function moveHistory(snapshot, history, actor, direction) {
  const label = direction === 'undo' ? '撤销' : '重做'
  try {
    validateActor(actor)
    const next = copyHistory(history)
    const entry = next.actors.find(item => item.actor === actor)
    const transaction = entry?.[direction].at(-1)
    if (!transaction) invalid(`该操作者没有可${label}的事务。`)
    const result = invert(snapshot, transaction)
    entry[direction].pop()
    entry[direction === 'undo' ? 'redo' : 'undo'].push(copyJson(result.changes))
    return { snapshot: result.snapshot, changes: result.changes, history: next }
  } catch (cause) {
    throw new CanvasEditError(`无法${label}：${cause.message}`, 'conflict', { cause })
  }
}

/** 返回 { snapshot, changes, history }；失败抛 conflict，所有输入保持不变。 */
export function undoCanvasTransaction(snapshot, history, actor) {
  return moveHistory(snapshot, history, actor, 'undo')
}

export function redoCanvasTransaction(snapshot, history, actor) {
  return moveHistory(snapshot, history, actor, 'redo')
}
