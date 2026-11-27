import { createElement as h, memo, useMemo } from 'react'
import { computed } from '@tldraw/state'
import { useValue } from '@tldraw/state-react'

const empty = Object.freeze([])
const placement = record => ({ parentId: record.parentId, index: record.index, type: record.type })
const samePlacement = (a, b) => a?.parentId === b?.parentId && a?.index === b?.index && a?.type === b?.type
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

function createBackgroundTree(scene, drawings, parentId) {
  // Indexed queries visit registered background types and their ancestors,
  // never every shape. Placements do not change when ink/color/opacity does.
  const queries = Object.entries(drawings).filter(([, value]) => value.background).map(([type]) => scene.store.query.ids('shape', () => ({ type: { eq: type } })))
  const locations = scene.store.createComputedCache('background placement', placement, { areResultsEqual: samePlacement })
  let previous = new Map()
  return computed('background tree', () => {
    const children = new Map()
    for (const query of queries) for (const id of query.get()) {
      const path = [], seen = new Set()
      let current = id
      while (current && current !== parentId && !seen.has(current)) {
        seen.add(current)
        const record = locations.get(current)
        if (!record) break
        // A frame runs its own background pass above its opaque body,
        // inside its normal clip. The outer pass stops at that boundary.
        if (current !== id && record.type === 'frame') break
        path.unshift(current); current = record.parentId
      }
      if (current !== parentId) continue
      let parent = parentId
      for (const child of path) {
        if (!children.has(parent)) children.set(parent, new Set())
        children.get(parent).add(child); parent = child
      }
    }
    const next = new Map()
    for (const [parent, ids] of children) {
      const ordered = [...ids].sort((a, b) => compare(locations.get(a).index || '', locations.get(b).index || '') || compare(a, b))
      const before = previous.get(parent)
      next.set(parent, before?.length === ordered.length && ordered.every((id, i) => before[i] === id) ? before : Object.freeze(ordered))
    }
    previous = next
    return next
  })
}

const BackgroundChildren = memo(function BackgroundChildren({ scene, drawings, tree, parentId }) {
  const ids = useValue('background child ids', () => tree.get().get(parentId) || empty, [tree, parentId])
  return ids.map(id => h(BackgroundShape, { scene, drawings, tree, id, key: id }))
})

const BackgroundShape = memo(function BackgroundShape({ scene, drawings, tree, id }) {
  const record = useValue('background record', () => scene.store.get(id), [scene, id])
  const erasing = useValue('background erase preview', () => scene.eraserPreview?.read(id) || false, [scene, id])
  if (!record || record.opacity === 0) return null
  const Drawing = drawings[record.type]?.background
  // Shared ancestors retain the normal tree's opacity-compositing boundary.
  return h('div', { 'data-renderer-background': id, ...(erasing && { 'data-erasing': '' }), style: { position: 'absolute', left: 0, top: 0, transform: `translate(${record.x}px, ${record.y}px) rotate(${record.rotation || 0}rad)`, transformOrigin: '0 0', opacity: scene.eraserPreview.opacity(id, record.opacity ?? 1) } },
    Drawing ? h(Drawing, { shape: record, background: true }) : null,
    h(BackgroundChildren, { scene, drawings, tree, parentId: id }))
})

export const BackgroundLayer = memo(function BackgroundLayer({ scene, drawings, parentId = scene.pageId }) {
  const tree = useMemo(() => createBackgroundTree(scene, drawings, parentId), [scene, drawings, parentId])
  return h(BackgroundChildren, { scene, drawings, tree, parentId })
})
