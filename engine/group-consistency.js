import { ungroupShape } from './commands/ungroup-shapes.js'

// 逐条保留变更前记录，覆盖同批新建组又删子项的中间父关系；不取完整快照。
export function previousRecords(changes) {
  return [...Object.values(changes.removed), ...Object.values(changes.updated).map(([before]) => before)]
}

/**
 * 组原点固定，范围由几何入口实时推导，不缓存尺寸。
 * 仅整理本次失去子形状的组；不把旧格式或底层命令创建的空组/单子组顺带改写。
 * 调用发生在整批命令之后，允许批中先移出、再补入子形状。
 */
export function reconcileGroups(store, previous) {
  const pending = new Set()
  for (const record of previous) if (record.typeName === 'shape' && store.get(record.id)?.parentId !== record.parentId) pending.add(record.parentId)
  for (const id of pending) {
    // 父组可能先检查过，内组消失后仍需允许它再次入队。
    pending.delete(id)
    const group = store.get(id)
    if (group?.typeName !== 'shape' || group.type !== 'group') continue
    const children = store.allRecords().filter(record => record.typeName === 'shape' && record.parentId === id)
    if (children.length > 1) continue
    ungroupShape(store, group)
    pending.add(group.parentId)
  }
}
