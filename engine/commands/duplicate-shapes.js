import { getIndicesAbove, sortByIndex } from '@tldraw/utils'
import { CanvasEditError } from '../errors.js'
import { createConnectionContext, getConnectionGeometry } from '../../renderer/geometry.js'

const DEFAULT_DUPLICATE_OFFSET = 16

function ancestors(store, record) {
  const result = [], visited = new Set([record.id])
  let parent = store.get(record.parentId)
  while (parent?.typeName === 'shape') {
    if (visited.has(parent.id)) throw new CanvasEditError('形状的父子关系形成循环。')
    visited.add(parent.id)
    result.push(parent)
    parent = store.get(parent.parentId)
  }
  return result
}

export function duplicateShapes(store, { ids, offset = { x: DEFAULT_DUPLICATE_OFFSET, y: DEFAULT_DUPLICATE_OFFSET } }) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || store.get(id)?.typeName !== 'shape')) throw new CanvasEditError('复制需要有效的形状 ID 列表。')
  if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new CanvasEditError('复制位移需要有效的 x、y 数值。')
  const records = store.allRecords()
  const selected = new Set(ids)
  const roots = [...selected].map(id => store.get(id)).filter(record => !ancestors(store, record).some(parent => selected.has(parent.id))).sort(sortByIndex)
  const children = new Map()
  for (const record of records) {
    if (record.typeName !== 'shape') continue
    if (!children.has(record.parentId)) children.set(record.parentId, [])
    children.get(record.parentId).push(record)
  }
  const originals = [...roots], included = new Set(roots.map(record => record.id))
  for (const record of originals) for (const child of children.get(record.id) || []) {
    if (!included.has(child.id)) { included.add(child.id); originals.push(child) }
  }
  const bindings = records.filter(record => record.typeName === 'binding' && included.has(record.fromId) && included.has(record.toId))
  const detached = records.filter(record => record.typeName === 'binding' && record.type === 'arrow' && included.has(record.fromId) && !included.has(record.toId))
  const geometry = detached.length && createConnectionContext(records), props = new Map()
  for (const binding of detached) {
    const arrow = store.get(binding.fromId)
    if (arrow?.type !== 'arrow') continue
    // 2026-11-26 native legacy Mod+D on a bound arrow: copy drops external
    // bindings but freezes visible tips (250 stored → 236.5 visible), also
    // when only the other endpoint's target is copied. Internal links remap.
    const path = getConnectionGeometry({ ...arrow, props: { ...arrow.props, richText: { type: 'doc', content: [{ type: 'paragraph' }] } } }, geometry).path
    props.set(arrow.id, { ...(props.get(arrow.id) || arrow.props), [binding.props.terminal]: path.at(binding.props.terminal === 'start' ? 0 : 1) })
  }
  const idMap = Object.fromEntries([...originals, ...bindings].map(record => [record.id, `${record.typeName}:${globalThis.crypto.randomUUID()}`]))
  const rootPositions = new Map()
  for (const parentId of new Set(roots.map(record => record.parentId))) {
    const siblings = children.get(parentId) || []
    const group = roots.filter(record => record.parentId === parentId)
    const indices = getIndicesAbove(siblings.map(record => record.index).sort().at(-1), group.length)
    for (const [i, record] of group.entries()) {
      // 位移以画布坐标给出；只平移根副本，子孙沿用各自的局部坐标。
      const angle = ancestors(store, record).reduce((rotation, parent) => rotation + parent.rotation, 0)
      rootPositions.set(record.id, { index: indices[i], x: record.x + Math.cos(angle) * offset.x + Math.sin(angle) * offset.y, y: record.y - Math.sin(angle) * offset.x + Math.cos(angle) * offset.y })
    }
  }
  for (const record of originals) {
    // 幻灯片布局器按此归属接回子页；框一起复制时必须改指新框。
    const slidesParentId = idMap[record.meta?.cowartAiSlidesParentShapeId]
    const meta = slidesParentId ? { ...record.meta, cowartAiSlidesParentShapeId: slidesParentId } : record.meta
    store.put([{ ...record, id: idMap[record.id], parentId: idMap[record.parentId] || record.parentId, meta, ...(props.has(record.id) && { props: props.get(record.id) }), ...rootPositions.get(record.id) }])
  }
  // Only bindings wholly inside the copied tree are retained.
  for (const record of bindings) store.put([{ ...record, id: idMap[record.id], fromId: idMap[record.fromId], toId: idMap[record.toId] }])
  return { idMap }
}
