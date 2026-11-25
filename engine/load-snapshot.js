import { createCanvasStore, isCanvasSnapshot } from '../model/index.js'
import { CanvasEditError } from './errors.js'

// 校验快照结构与单条记录并迁移到当前模型；跨记录关系由调用方在事务末尾校验。
// 成功后存储归调用方，必须 dispose；载入失败时在这里释放。
export function loadValidatedCanvasSnapshot(snapshot) {
  let store
  try {
    if (!isCanvasSnapshot(snapshot)) throw new CanvasEditError('无效的画板快照。')
    const pages = Object.values(snapshot.store).filter(record => record?.typeName === 'page')
    if (pages.length !== 1) throw new CanvasEditError('画板必须只有一张内部画布。')
    store = createCanvasStore()
    for (const [id, record] of Object.entries(snapshot.store)) {
      if (record?.id !== id || !store.scopedTypes.document.has(record?.typeName)) throw new CanvasEditError('画板记录 ID 或类型无效。')
    }
    store.loadStoreSnapshot(structuredClone(snapshot))
    return { store, pageId: pages[0].id }
  } catch (error) {
    store?.dispose()
    if (error instanceof CanvasEditError) throw error
    throw new CanvasEditError(String(error?.message || error).split('\n')[0], 'invalid-input', { cause: error })
  }
}
