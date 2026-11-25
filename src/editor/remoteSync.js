// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { describeSkippedRecord, isCanvasSnapshot, sanitizeCanvasSnapshot } from "../../model/index.js"
function recordsAreEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
const REMOTE_REMOVABLE_RECORD_TYPES = new Set(['asset', 'binding', 'shape', 'page', 'document', 'user'])
function isRemoteRemovableRecord(record) {
  return REMOTE_REMOVABLE_RECORD_TYPES.has(record?.typeName)
}
function storeChangedSinceSnapshot(editor, baselineStore) {
  const currentStore = editor.store.getStoreSnapshot().store
  const baselineIds = new Set(Object.keys(baselineStore))
  for (const [id, baselineRecord] of Object.entries(baselineStore)) {
    const currentRecord = currentStore[id]
    if (!currentRecord) return true
    if (!recordsAreEqual(currentRecord, baselineRecord)) return true
  }
  for (const id of Object.keys(currentStore)) {
    if (!baselineIds.has(id)) return true
  }
  return false
}
function applyRemoteCanvasSnapshot(editor, snapshot, { preserveLocalChanges = false } = {}) {
  if (!isCanvasSnapshot(snapshot)) return { changedRecords: 0, skippedRecords: [] }
  const sanitized = sanitizeCanvasSnapshot(snapshot)
  if (!sanitized.snapshot || sanitized.skippedRecords.length) return { changedRecords: 0, skippedRecords: sanitized.skippedRecords }
  const recordsToPut = Object.values(sanitized.snapshot.store).filter((record) => {
    if (preserveLocalChanges) return false
    const localRecord = editor.store.get(record.id)
    if (!localRecord) return true
    return !recordsAreEqual(localRecord, record)
  })
  const remoteRecordIds = new Set(Object.keys(sanitized.snapshot.store))
  const recordsToRemove = preserveLocalChanges
    ? []
    : Object.values(editor.store.getStoreSnapshot().store)
        .filter((record) => isRemoteRemovableRecord(record) && !remoteRecordIds.has(record.id))
        .map((record) => record.id)
  if (recordsToPut.length === 0 && recordsToRemove.length === 0) {
    return { changedRecords: 0, skippedRecords: sanitized.skippedRecords }
  }
  let changedRecords = 0
  editor.store.mergeRemoteChanges(() => {
    for (const record of recordsToPut) {
      try {
        editor.store.put([record])
        changedRecords += 1
      } catch (error) {
        sanitized.skippedRecords.push(describeSkippedRecord(record, error))
      }
    }
    if (recordsToRemove.length > 0) {
      editor.store.remove(recordsToRemove)
      changedRecords += recordsToRemove.length
    }
  })
  // 批处理结束后新页面的相机和会话状态才齐备，提前切页会让编辑器崩溃。
  if (!remoteRecordIds.has(editor.getCurrentPageId())) {
    const page = Object.values(sanitized.snapshot.store).find(record => record.typeName === 'page')
    if (page) editor.setCurrentPage(page.id)
  }
  return { changedRecords, skippedRecords: sanitized.skippedRecords }
}
export { recordsAreEqual, REMOTE_REMOVABLE_RECORD_TYPES, isRemoteRemovableRecord, storeChangedSinceSnapshot, applyRemoteCanvasSnapshot }
