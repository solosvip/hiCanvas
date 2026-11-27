import { createElement as h } from 'react'
import { orderedChildren } from './geometry.js'
import { exportShape } from './export-shapes.js'

export function createExportScene(snapshot, { pageId, ids } = {}) {
  if (!snapshot?.store || typeof snapshot.store !== 'object') throw new Error('输出需要文档快照。')
  const fixed = structuredClone(snapshot), records = fixed.store
  const page = pageId || Object.values(records).find(r => r.typeName === 'page')?.id
  if (records[page]?.typeName !== 'page') throw new Error('输出页面不存在。')
  const children = orderedChildren(Object.values(records)), included = new Set(), wrappers = new Set()
  function descendants(id, chain = new Set()) {
    if (chain.has(id)) throw new Error('形状父子关系存在环。')
    const shape = records[id]
    if (shape?.typeName !== 'shape') throw new Error('输出对象不存在。')
    included.add(id)
    for (const child of children.get(id) || []) descendants(child.id, new Set([...chain, id]))
  }
  if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) throw new Error('输出对象列表无效。')
  for (const id of ids === undefined ? (children.get(page) || []).map(r => r.id) : ids) {
    descendants(id)
    let record = records[id], seen = new Set()
    while (record?.typeName === 'shape') {
      if (seen.has(record.id)) throw new Error('形状父子关系存在环。')
      seen.add(record.id); wrappers.add(record.id); record = records[record.parentId]
    }
    if (record?.id !== page) throw new Error('输出对象不属于指定页面。')
  }
  for (const id of included) wrappers.add(id)
  const shapes = Object.values(records).filter(r => included.has(r.id))
  return { snapshot: fixed, records, page, children, included, wrappers, shapes }
}

export function serializeExportScene(scene, size, { background, media = new Map(), fontCss = '', renderToStaticMarkup } = {}) {
  const store = { allRecords: () => Object.values(scene.records), get: id => scene.records[id] }
  const defs = [], clipIds = new Map()
  for (const shape of Object.values(scene.records)) if (scene.wrappers.has(shape.id) && shape.type === 'frame') {
    const id = `export-clip-${clipIds.size}`; clipIds.set(shape.id, id)
    defs.push(h('clipPath', { id, key: id }, h('rect', { width: shape.props.w, height: shape.props.h })))
  }
  const visitChildren = (parentId, backgroundPass) => (scene.children.get(parentId) || []).filter(shape => scene.wrappers.has(shape.id)).map(shape => visit(shape, backgroundPass))
  const visit = (shape, backgroundPass) => {
    if (backgroundPass && shape.type === 'frame') return null
    const selected = scene.included.has(shape.id), isFrame = shape.type === 'frame'
    const body = selected && (backgroundPass ? shape.type === 'highlight' : true) ? exportShape(shape, { scene, store, media, background: backgroundPass }) : null
    const children = isFrame
      ? h('g', { clipPath: `url(#${clipIds.get(shape.id)})` }, visitChildren(shape.id, true), visitChildren(shape.id, false))
      : visitChildren(shape.id, backgroundPass)
    return h('g', { key: shape.id, 'data-export-shape': shape.id, transform: `translate(${shape.x} ${shape.y}) rotate(${(shape.rotation || 0) * 180 / Math.PI})`, opacity: shape.opacity ?? 1 }, body, children)
  }
  const b = size.bounds
  return renderToStaticMarkup(h('svg', { xmlns: 'http://www.w3.org/2000/svg', width: size.width, height: size.height, viewBox: `${b.x} ${b.y} ${b.w} ${b.h}` },
    h('defs', null, fontCss ? h('style', null, fontCss) : null, defs),
    background ? h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: background }) : null,
    visitChildren(scene.page, true), visitChildren(scene.page, false)))
}
