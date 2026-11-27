import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

// Isolated, in-memory fixtures. Native probes only read these records; all
// edits enter the ordinary mouse/keyboard interaction and transport boundary.
export function createFrameFixture(kind = 'drag') {
  const rotated = kind.endsWith('-rotated'), fitting = kind.startsWith('fit')
  const frame = (id, x, y, props, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'frame', x, y, props, ...extra })
  const shape = (id, x, y, w, h, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { w, h, fill: 'solid' }, ...extra })
  const commands = kind === 'drag' ? [
    frame('target', 400, 200, { w: 300, h: 260, name: '拖入目标' }), shape('a', 100, 100, 120, 80),
  ] : [
    frame('f', rotated ? 450 : 220, 180, { w: 360, h: 260, name: '裁框与适配' }, { rotation: rotated ? .37 : 0 }),
    shape('a', fitting ? -30 : 60, fitting ? -20 : 60, 120, 80, { parentId: 'shape:f' }),
    shape('b', fitting ? 220 : 200, fitting ? 160 : 100, fitting ? 100 : 90, fitting ? 70 : 80, { parentId: 'shape:f' }),
    { type: 'toggle_lock', ids: ['shape:b'] },
    ...(!fitting ? [shape('guide', 253, 500, 100, 80)] : []),
  ]
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
  const records = Object.values(snapshot.store).filter(r => r.typeName === 'shape')
  return { snapshot, frameInteractionFixture: true, count: records.length, counts: records.reduce((counts, r) => ({ ...counts, [r.type]: (counts[r.type] || 0) + 1 }), {}), assetCount: 0,
    viewState: { currentPageId: 'page:page', camera: { x: 0, y: 0, z: 1 } } }
}
