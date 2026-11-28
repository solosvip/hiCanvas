import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { createExportFixture } from './export-fixture.js'

export const flattenFixtureCases = Object.freeze(['static', 'text', 'media', 'group-all', 'group-sibling', 'frame', 'cross-parent', 'interleaved', 'image', 'locked'])
export function createFlattenFixture(initial = createCanvasSnapshot(), kind = 'static') {
  if (!flattenFixtureCases.includes(kind)) throw new Error('未知扁平化合成画板。')
  let data
  if (['static', 'text', 'media'].includes(kind)) data = createExportFixture(initial, kind)
  else {
    const shape = (id, shapeType, x, y, extra = {}) => ({ type: 'create_shape', id: `shape:flat-${id}`, shapeType, x, y, ...extra })
    const commands = [shape('a', 'geo', 160, 240, { props: { w: 120, h: 100, fill: 'solid', color: 'red', dash: 'solid' } }), shape('b', 'geo', 400, 270, { props: { w: 100, h: 80, fill: 'solid', color: 'blue', dash: 'solid' } })]
    if (kind.startsWith('group')) {
      if (kind === 'group-sibling') commands.push(shape('sibling', 'geo', 650, 260, { props: { fill: 'solid', color: 'green' } }))
      commands.push({ type: 'group_shapes', ids: commands.map(command => command.id), groupId: 'shape:flat-group' }, { type: 'update', id: 'shape:flat-group', changes: { opacity: .5, rotation: .15 } })
    }
    if (kind === 'frame' || kind === 'cross-parent') {
      commands.push(shape('frame', 'frame', 140, 180, { props: { w: 400, h: 240, name: 'Clipped 合成' } }), { type: 'update', id: 'shape:flat-a', changes: { parentId: 'shape:flat-frame', x: 20, y: 60 } })
      if (kind === 'frame') commands.push({ type: 'update', id: 'shape:flat-b', changes: { parentId: 'shape:flat-frame', x: 350, y: 160 } }, { type: 'update', id: 'shape:flat-frame', changes: { rotation: .15, opacity: .5 } })
    }
    if (kind === 'interleaved') commands.push(shape('middle', 'geo', 700, 230), ...[['a', 'a1'], ['middle', 'a2'], ['b', 'a3']].map(([id, index]) => ({ type: 'update', id: `shape:flat-${id}`, changes: { index } })))
    if (kind === 'image') {
      const asset = createExportFixture(initial, 'media').snapshot.store['asset:export-image']
      commands.splice(0, commands.length, { type: 'put', record: asset }, shape('image', 'image', 160, 240, { props: { w: 120, h: 100, assetId: asset.id } }))
    }
    if (kind === 'locked') commands.push({ type: 'toggle_lock', ids: ['shape:flat-a'] })
    const snapshot = executeCanvasCommands(initial, commands).snapshot, shapes = Object.values(snapshot.store).filter(r => r.typeName === 'shape')
    data = { snapshot, count: shapes.length, counts: Object.fromEntries([...new Set(shapes.map(s => s.type))].map(type => [type, shapes.filter(s => s.type === type).length])), viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
  }
  if (kind === 'text') {
    // Select-all omits invisible roots. Keep the zero-opacity sample inside a
    // selected container so the positive text case has no unselected interleave.
    const invisible = data.snapshot.store['shape:export-opacity']
    invisible.parentId = 'shape:export-frame'; invisible.x = 30; invisible.y = 30
  }
  return { ...data, viewState: { ...data.viewState, version: 1 }, exportFixture: undefined, flattenFixture: kind }
}
