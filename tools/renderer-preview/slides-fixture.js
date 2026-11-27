import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { syntheticPng } from '../perf/fixture.mjs'

export const slidesFixtureCases = ['base', 'empty', 'locked', 'rotated', 'group']
// All records are synthetic. Persistent preview hosts provision a fresh board
// per case; normal native input is the only way the driver edits those boards.
export function createSlidesFixture(input = createCanvasSnapshot(), kind = 'base') {
  if (!slidesFixtureCases.includes(kind)) throw new Error('未知 Slides 合成场景。')
  const seed = createCanvasSnapshot(input), bytes = syntheticPng(142), assetId = 'asset:slides-native'
  seed.store[assetId] = { id: assetId, typeName: 'asset', type: 'image', meta: {}, props: { name: 'slides-native.png', src: `data:image/png;base64,${bytes.toString('base64')}`, w: 256, h: 192, mimeType: 'image/png', isAnimated: false, fileSize: bytes.length } }
  const frame = (id, x, y, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'frame', x, y, props: { w: 1048, h: 600, name: id }, meta: { cowartAiSlides: true }, ...extra })
  const page = (id, x, w, h, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'image', parentId: 'shape:d', x, y: 12, props: { w, h, assetId }, ...extra })
  const commands = [
    ...(kind === 'group' ? [{ type: 'create_shape', id: 'shape:g', shapeType: 'group', x: 60, y: 20, rotation: .1 }] : []),
    frame('d', 50, 100, { ...(kind === 'group' && { parentId: 'shape:g' }), rotation: kind === 'rotated' ? .15 : 0, ...(kind === 'empty' && { props: { w: 280, h: 180, name: 'empty' } }) }),
    frame('target', 1500, 100),
    ...(kind === 'empty' ? [] : [page('a', 12, 240, 140), page('b', 400, 360, 220, { meta: { cowartAiSlidesParentShapeId: 'shape:d' } }), page('c', 850, 180, 170)]),
    page('outside', 100, 160, 110, { parentId: 'page:page', x: 110, y: 1000 }),
  ]
  let snapshot = executeCanvasCommands(seed, commands).snapshot
  // Establish the laid-out document before locking its middle page. Locking
  // during creation would correctly reject that transaction's required move.
  if (kind === 'locked') snapshot = executeCanvasCommands(snapshot, [{ type: 'toggle_lock', ids: ['shape:b'] }]).snapshot
  const records = Object.values(snapshot.store).filter(r => r.typeName === 'shape')
  return { snapshot, slidesFixture: true, fixtureCase: kind, count: records.length, counts: { frame: 2, image: kind === 'empty' ? 1 : 4 }, assetCount: 1, viewState: { currentPageId: 'page:page', camera: { x: 0, y: 0, z: .5 } } }
}
