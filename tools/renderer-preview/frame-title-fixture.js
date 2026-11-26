// Both production-editor and independent-renderer measurements use this exact
// snapshot. Keep IDs, assets, target and camera from the shared 5000 fixture.
export function createFrameTitleFixture(fixture, titles = true) {
  const result = structuredClone(fixture), records = Object.values(result.snapshot.store)
  const shapes = records.filter(record => record.typeName === 'shape')
  if (shapes.length !== 5000) throw new Error('标题性能资料必须恰好5000个形状')
  const rectangle = shapes.find(shape => shape.type === 'geo').props
  for (let i = 0; i < 50; i++) result.snapshot.store[shapes[i].id] = { ...shapes[i], type: titles ? 'frame' : 'geo', x: i % 10 * 400, y: Math.floor(i / 10) * 400, props: titles ? { w: 280, h: 240, name: `Frame ${i} with a long measured title`, color: 'black' } : { ...rectangle, w: 280, h: 240, geo: 'rectangle', size: 's', color: 'black', fill: 'semi' } }
  result.counts = {}
  for (const shape of Object.values(result.snapshot.store).filter(record => record.typeName === 'shape')) result.counts[shape.type] = (result.counts[shape.type] || 0) + 1
  return result
}
