import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { strokeProps, strokeSegment } from './stroke-fixtures.js'

// Synthetic scene coordinates, independent of eraser hit-test helpers.
export function createEraserFixture(mode = 'multi') {
  const initial = createCanvasSnapshot(), pageId = Object.values(initial.store).find(r => r.typeName === 'page').id
  const geo = (id, x, y, props = {}, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { w: 100, h: 80, fill: 'solid', color: 'blue', ...props }, ...extra })
  const commands = mode === 'empty' ? [] : mode === 'group' ? [
    geo('left', 180, 220), geo('right', 400, 220),
    { type: 'put', record: { id: 'shape:highlight', typeName: 'shape', type: 'highlight', x: 180, y: 420, rotation: 0, index: 'a9', parentId: pageId, isLocked: false, opacity: 1, meta: {}, props: strokeProps('highlight', { size: 'xl', segments: [strokeSegment([{ x: 0, y: 0, z: .5 }, { x: 180, y: 0, z: .5 }], 'straight')] }) } },
    { type: 'group_shapes', ids: ['shape:left', 'shape:right', 'shape:highlight'], groupId: 'shape:group' },
    { type: 'update', id: 'shape:left', changes: { isLocked: true } },
  ] : mode === 'frame' ? [
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 650, y: 220, props: { w: 200, h: 150 } },
    geo('child', 20, 20, { w: 70, h: 60 }, { parentId: 'shape:frame' }),
    geo('clipped', 180, 90, { w: 80, h: 50 }, { parentId: 'shape:frame' }),
  ] : mode === 'geometry' ? [
    geo('hollow', 100, 200, { w: 200, h: 200, geo: 'ellipse', fill: 'none' }),
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 650, y: 300, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, arrowheadEnd: 'none' } },
    geo('small', 366, 316, { w: 8, h: 8 }),
  ] : [
    geo('back', 180, 220), geo('front', 200, 230, { color: 'red' }), geo('far', 500, 220),
    geo('locked', 800, 220), geo('transparent', 800, 220),
    { type: 'update', id: 'shape:locked', changes: { isLocked: true } },
    { type: 'update', id: 'shape:transparent', changes: { opacity: 0 } },
    { type: 'update', id: 'shape:front', changes: { opacity: mode === 'half' ? .5 : 1 } },
  ]
  const snapshot = commands.length ? executeCanvasCommands(initial, commands).snapshot : initial
  const shapes = Object.values(snapshot.store).filter(record => record.typeName === 'shape')
  const counts = shapes.reduce((all, shape) => ({ ...all, [shape.type]: (all[shape.type] || 0) + 1 }), {})
  return { snapshot, eraserFixture: true, count: shapes.filter(shape => shape.opacity !== 0).length, counts, assetCount: 0,
    viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
}
