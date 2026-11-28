import { CanvasEditError } from './errors.js'
import { MAX_TRANSACTION_COMMANDS } from './execute.js'
import { isSlidesContainer } from './slides-layout.js'
import { collectCopyTree } from './clipboard/tree.js'
import { getMediaTarget } from './media-target.js'

// Semantic read dependencies live here, not in the dialog or HTTP adapters.
export function getRecordDependencies(snapshot, commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > MAX_TRANSACTION_COMMANDS || commands.some(command => !['insert_url', 'convert_url_shape', 'set_image_alt_text', 'set_shape_link', 'copy_content', 'delete', 'paste_content', 'media_import_target', 'insert_image', 'insert_video', 'replace_image', 'replace_video'].includes(command?.type))) throw new CanvasEditError('此命令尚不支持记录前置条件。', 'unsupported-record-basis')
  const ids = new Set(), memberships = new Map()
  const values = Object.values(snapshot.store)
  const children = new Map(), outgoing = new Map(), incoming = new Map()
  const index = (map, key, record) => { if (!map.has(key)) map.set(key, []); map.get(key).push(record) }
  for (const record of values) {
    if (record.typeName === 'shape') index(children, record.parentId, record)
    if (record.typeName === 'binding') { index(outgoing, record.fromId, record); index(incoming, record.toId, record) }
  }
  const member = (kind, id) => memberships.set(`${kind}:${id}`, { kind, id })
  function page(id) {
    if (snapshot.store[id]?.typeName !== 'page') throw new CanvasEditError('目标画布已失效。', 'conflict')
    ids.add(id)
  }
  function lineage(id) {
    let record = snapshot.store[id]
    if (record?.typeName === 'page') { page(id); return }
    if (record?.typeName !== 'shape') throw new CanvasEditError('目标记录已失效。', 'conflict')
    const seen = new Set()
    while (record?.typeName === 'shape') {
      if (seen.has(record.id)) throw new CanvasEditError('目标祖先形成循环。', 'conflict')
      seen.add(record.id); ids.add(record.id)
      if (isSlidesContainer(record)) {
        member('children', record.id)
        for (const child of children.get(record.id) || []) ids.add(child.id)
      }
      if (record.props.assetId) ids.add(record.props.assetId)
      record = snapshot.store[record.parentId]
    }
    if (record?.typeName !== 'page') throw new CanvasEditError('目标所属画布已失效。', 'conflict')
    ids.add(record.id)
  }
  const geometrySeen = new Set()
  function geometry(id) {
    if (geometrySeen.has(id)) return
    geometrySeen.add(id); lineage(id)
    const record = snapshot.store[id]
    if (record.type === 'group') {
      member('children', id)
      for (const child of children.get(id) || []) geometry(child.id)
    }
    if (record.type === 'arrow') {
      member('bindings-from', id)
      for (const binding of outgoing.get(id) || []) { ids.add(binding.id); geometry(binding.toId) }
    }
  }
  function copyTree(selected) {
    if (!Array.isArray(selected) || !selected.length || selected.some(id => snapshot.store[id]?.typeName !== 'shape')) throw new CanvasEditError('复制或剪切的目标已失效。', 'conflict')
    const tree = collectCopyTree({ get: id => snapshot.store[id], allRecords: () => values }, selected)
    for (const record of tree.originals) {
      lineage(record.id); member('children', record.id)
      if (record.type === 'arrow') geometry(record.id)
    }
    for (const binding of tree.bindings) ids.add(binding.id)
    return tree.originals
  }
  function deletingBindings(id, removed) {
    member('bindings-from', id); member('bindings-to', id)
    for (const binding of [...outgoing.get(id) || [], ...incoming.get(id) || []]) {
      ids.add(binding.id)
      if (!removed.has(binding.fromId) && binding.type === 'arrow') geometry(binding.fromId)
    }
  }
  function deleting(selected) {
    const removed = new Set(copyTree(selected).map(record => record.id))
    const parents = new Set([...removed].map(id => snapshot.store[id].parentId))
    for (const id of removed) deletingBindings(id, removed)
    for (const id of parents) {
      const group = snapshot.store[id]
      if (group?.type !== 'group') continue
      member('children', id)
      const remaining = (children.get(id) || []).filter(record => !removed.has(record.id))
      if (remaining.length > 1) continue
      lineage(id)
      for (const child of remaining) lineage(child.id)
      // Automatic ungrouping reads the outside indices before restoring order.
      member('children', group.parentId)
      for (const sibling of children.get(group.parentId) || []) ids.add(sibling.id)
      removed.add(id); deletingBindings(id, removed); parents.add(group.parentId)
    }
  }
  function replacingHolder(anchor) {
    const removed = new Set([anchor.id])
    deletingBindings(anchor.id, removed)
    let group = snapshot.store[anchor.parentId], promoted = 1 + (children.get(anchor.id) || []).length
    while (group?.type === 'group') {
      // Match reconcileGroups' final child count; keep both rules in sync.
      // Count-only membership conservatively rejects same-group additions/removals.
      member('children', group.id)
      const remaining = (children.get(group.id) || []).filter(record => !removed.has(record.id))
      promoted += remaining.length
      if (promoted > 1) break
      lineage(group.id)
      for (const child of remaining) lineage(child.id)
      member('children', group.parentId)
      for (const sibling of children.get(group.parentId) || []) ids.add(sibling.id)
      removed.add(group.id); deletingBindings(group.id, removed)
      group = snapshot.store[group.parentId]
    }
  }
  for (const command of commands) {
    if (command.type === 'media_import_target') {
      const { pageId } = getMediaTarget(snapshot, { pageId: command.pageId, anchorShapeId: command.replaceId })
      page(pageId)
      if (command.replaceId != null) {
        const record = snapshot.store[command.replaceId]
        if (!['image', 'video'].includes(record?.type)) throw new CanvasEditError('替换目标不是有效媒体。', 'conflict')
        lineage(record.id)
      }
      continue
    }
    if (['insert_image', 'insert_video'].includes(command.type)) {
      const args = command.args || {}, { anchor, pageId } = getMediaTarget(snapshot, command.type === 'insert_video' ? { pageId: args.pageId } : args)
      page(pageId)
      if (anchor) lineage(anchor.id)
      if (command.type === 'insert_image') {
        const slides = isSlidesContainer(anchor), holder = anchor?.type === 'frame' && anchor.meta?.cowartAiImageHolder
        const match = !!anchor && args.matchAnchor !== false && !slides
        const replace = holder && match && args.replaceAiImageHolder !== false, fill = holder && match && !replace
        const parentId = slides || fill ? anchor.id : anchor?.parentId || pageId
        if (!replace && !fill && !slides && args.avoidOverlap !== false) {
          member('children', parentId)
          for (const sibling of children.get(parentId) || []) ids.add(sibling.id)
        }
        if (replace) {
          member('children', anchor.id)
          for (const child of children.get(anchor.id) || []) lineage(child.id)
          // ADR 0017: moved annotations receive new indices under the lock;
          // do not freeze siblings (HTTP regression: 标注新层序在锁内分配).
          replacingHolder(anchor)
        }
      }
      continue
    }
    if (['replace_image', 'replace_video'].includes(command.type)) {
      lineage(command.id)
      if (command.assetId !== undefined) ids.add(command.assetId)
      continue
    }
    if (command.type === 'copy_content') {
      copyTree(command.ids)
      continue
    }
    if (command.type === 'delete') {
      deleting(command.ids)
      continue
    }
    if (command.type === 'paste_content') {
      const parentId = command.parentId || values.find(record => record.typeName === 'page')?.id
      lineage(parentId)
      continue
    }
    if (command.type === 'insert_url') {
      if (snapshot.store[command.pageId]?.typeName !== 'page') throw new CanvasEditError('网址插入需要明确的目标画布。', 'conflict')
      ids.add(command.pageId)
      if (command.id !== undefined) {
        if (typeof command.id !== 'string' || !command.id.startsWith('shape:')) throw new CanvasEditError('新对象编号无效。')
        ids.add(command.id)
      }
      continue
    }
    const record = snapshot.store[command.id]
    if (record?.typeName !== 'shape') throw new CanvasEditError('目标记录已失效。', 'conflict')
    if (command.type === 'convert_url_shape' && record.type === 'bookmark' && record.props.assetId) {
      const id = record.props.assetId
      memberships.set(`asset-users:${id}`, { kind: 'asset-users', id })
    }
    lineage(record.id)
  }
  return { ids: [...ids].sort(), memberships: [...memberships.values()], commandBytes: new TextEncoder().encode(JSON.stringify(commands)).length }
}
