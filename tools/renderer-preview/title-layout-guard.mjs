// Guard the actual layout roots as well as the nodes that invalidated layout.
// Empty / unlocatable traces cannot establish isolation and must fail closed.
export function checkTitleLayoutTrace(events, allowedTitleIds) {
  const allowed = new Set(allowedTitleIds)
  const layouts = events.filter(event => event.name === 'Layout')
  const invalidations = events.filter(event => event.name === 'LayoutInvalidationTracking')
  if (!layouts.length || !invalidations.length) throw new Error('缺少标题布局或失效证据')
  for (const event of invalidations) {
    const id = event.args?.data?.nodeId
    if (!id || !allowed.has(id)) throw new Error(`标题以外或无法定位的布局失效：${id}`)
  }
  const roots = layouts.flatMap(event => {
    const roots = event.args?.endData?.layoutRoots
    if (!roots?.length) throw new Error('无法定位实际布局根')
    return roots
  })
  for (const root of roots) if (!root.nodeId || !allowed.has(root.nodeId)) throw new Error(`布局传播到标题以外：${root.nodeName} (${root.nodeId})`)
  return { layoutEvents: layouts.length, titleLayoutInvalidations: invalidations.length, titleLayoutRoots: new Set(roots.map(root => root.nodeId)).size, outsideTitleLayoutRoots: 0 }
}
