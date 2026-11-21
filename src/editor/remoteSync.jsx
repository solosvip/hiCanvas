// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { describeSkippedRecord, isCanvasSnapshot, sanitizeCanvasSnapshotForTldraw } from "../canvasSnapshot.js"
function recordsAreEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
const REMOTE_REMOVABLE_RECORD_TYPES = new Set(['asset', 'binding', 'shape'])
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
  const sanitized = sanitizeCanvasSnapshotForTldraw(snapshot)
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
    if (recordsToRemove.length > 0) {
      editor.store.remove(recordsToRemove)
      changedRecords += recordsToRemove.length
    }
    for (const record of recordsToPut) {
      try {
        editor.store.put([record])
        changedRecords += 1
      } catch (error) {
        sanitized.skippedRecords.push(describeSkippedRecord(record, error))
      }
    }
  })
  return { changedRecords, skippedRecords: sanitized.skippedRecords }
}
export { recordsAreEqual, REMOTE_REMOVABLE_RECORD_TYPES, isRemoteRemovableRecord, storeChangedSinceSnapshot, applyRemoteCanvasSnapshot }
