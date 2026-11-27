import { charge, svgError, svgLimits } from './svg-budget.mjs'

export function checkSvgReferences(nodes, removedIds, warn, budget) {
  const ids = new Map()
  for (const node of nodes) if (node.id) {
    if (ids.has(node.id)) svgError('ID 重复')
    ids.set(node.id, node)
  }
  for (const node of nodes) {
    node.edges = node.children.map(target => ({ target, count: 1, reference: false }))
    for (const reference of node.references) {
      if (reference.removed?.()) continue
      const target = ids.get(reference.id)
      if (!target && removedIds.has(reference.id)) { reference.remove(); warn('已移除指向不支持效果的引用'); continue }
      if (!target || !reference.kinds.includes(target.tag)) svgError('内部引用缺失或类型不符')
      charge(budget, 'references')
      node.edges.push({ target, marker: reference.marker, paint: reference.paint, reference: true })
    }
  }
  // Iterative topological order: even a long, shallow use-chain never reaches
  // the JavaScript call-stack limit before the reference-depth guard.
  const states = new Map(), order = []
  for (const start of nodes) {
    if (states.has(start)) continue
    const stack = [{ node: start, index: 0 }]; states.set(start, 1)
    while (stack.length) {
      const frame = stack.at(-1), edge = frame.node.edges[frame.index++]
      if (!edge) { states.set(frame.node, 2); order.push(frame.node); stack.pop(); continue }
      if (states.get(edge.target) === 1) svgError('内部引用循环')
      if (!states.has(edge.target)) { states.set(edge.target, 1); stack.push({ node: edge.target, index: 0 }) }
    }
  }
  const geometry = new Map(), costs = new Map()
  for (const node of order) {
    const shapes = { vertices: node.vertices, paths: node.paths, paints: node.paints }
    for (const edge of node.edges) if (!edge.marker) {
      const next = geometry.get(edge.target)
      shapes.vertices += next.vertices; shapes.paths += next.paths; shapes.paints += next.paints
      if (!Number.isSafeInteger(shapes.vertices) || shapes.vertices > svgLimits.parameters + 2 * svgLimits.expanded || shapes.paths > svgLimits.expanded || shapes.paints > svgLimits.expanded) svgError('展开路径超出限制')
    }
    geometry.set(node, shapes)
    const total = { expanded: 1, parameters: node.parameters, rasterPixels: node.rasterPixels, referenceDepth: 0 }
    for (const edge of node.edges) {
      // Group/use/CSS marker properties inherit into descendant geometry.
      // Count that geometry, including referenced use subtrees, conservatively
      // even when a descendant explicitly overrides the inherited property.
      const count = edge.marker === 'mid' ? shapes.vertices : edge.marker ? shapes.paths : edge.paint ? shapes.paints : 1
      const next = costs.get(edge.target)
      for (const key of ['expanded', 'parameters', 'rasterPixels']) {
        total[key] += next[key] * count
        if (!Number.isSafeInteger(total[key]) || total[key] > svgLimits[key]) svgError(`展开 ${key} 超出限制`)
      }
      total.referenceDepth = Math.max(total.referenceDepth, next.referenceDepth + Number(edge.reference))
      if (total.referenceDepth > svgLimits.referenceDepth) svgError('引用深度超出限制')
    }
    costs.set(node, total)
  }
}
