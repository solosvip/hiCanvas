import { executeCanvasCommands } from '../engine/index.js'

// 旧媒体流程仍持有 snapshot.store 的引用；只保留就地提交的兼容入口。
// 所有编辑规则和校验由编辑层执行，成功之前不改调用方的任何数据。
export function applyCanvasOperations(snapshot, operations) {
  const result = executeCanvasCommands(snapshot, operations)
  for (const id of Object.keys(snapshot.store)) delete snapshot.store[id]
  Object.assign(snapshot.store, result.snapshot.store)
  snapshot.schema = result.snapshot.schema
  return snapshot
}
