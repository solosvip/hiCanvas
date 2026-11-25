import { recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

// 每个服务实例独立保管，重启即清空。编辑层每操作者最多留 100 条事务，
// 足够回退近期手势，并避免长期会话的历史无限增长；这里复用其上限与算法。
export function createCanvasHistory() {
  const canvases = new Map()
  const history = (id, actor) => canvases.get(id)?.get(actor)
  function accept(id, actor, next) {
    return () => {
      if (!next.actors.length) return
      if (!canvases.has(id)) canvases.set(id, new Map())
      canvases.get(id).set(actor, next)
    }
  }
  function move(direction, id, actor, snapshot) {
    const edit = (direction === 'undo' ? undoCanvasTransaction : redoCanvasTransaction)(snapshot, history(id, actor), actor)
    return { snapshot: edit.snapshot, changes: edit.changes, results: [], acceptHistory: accept(id, actor, edit.history) }
  }
  return {
    record(id, actor, changes) { return accept(id, actor, recordCanvasTransaction(history(id, actor), actor, changes)) },
    undo: (id, actor, snapshot) => move('undo', id, actor, snapshot),
    redo: (id, actor, snapshot) => move('redo', id, actor, snapshot),
    forget: id => canvases.delete(id),
  }
}
