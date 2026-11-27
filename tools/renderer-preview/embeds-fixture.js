import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { videoData } from './video-fixtures.js'

export function createEmbedsFixture(kind) {
  let snapshot = createCanvasSnapshot()
  if (kind === 'interaction') snapshot = executeCanvasCommands(snapshot, [
    { type: 'create_shape', id: 'shape:embed-a', shapeType: 'embed', x: 80, y: 60, props: { url: 'https://www.youtube.com/watch?v=synthetic83', w: 480, h: 270 } },
    { type: 'create_shape', id: 'shape:embed-b', shapeType: 'embed', x: 680, y: 60, props: { url: 'https://www.figma.com/file/abcdefghijklmnopqrstuv/hiCanvas', w: 400, h: 280 } },
    { type: 'create_shape', id: 'shape:embed-scratch', shapeType: 'embed', x: 80, y: 390, props: { url: 'https://scratch.mit.edu/projects/123456789/', w: 280, h: 210 } },
    { type: 'put', record: { id: 'asset:embed-video', typeName: 'asset', type: 'video', props: { src: videoData.mp4, name: '合成视频', w: 320, h: 180, mimeType: 'video/mp4', isAnimated: true }, meta: {} } },
    { type: 'create_shape', id: 'shape:embed-video', shapeType: 'video', x: 900, y: 410, props: { assetId: 'asset:embed-video', w: 256, h: 144 } },
    { type: 'create_shape', id: 'shape:embed-geo', shapeType: 'geo', x: 680, y: 430, props: { w: 140, h: 70, fill: 'solid' } },
  ]).snapshot
  const records = Object.values(snapshot.store), shapes = records.filter(r => r.typeName === 'shape'), pageId = records.find(r => r.typeName === 'page').id
  return { snapshot, viewState: { currentPageId: pageId, camera: { x: 0, y: 0, z: 1 } }, count: shapes.length, counts: shapes.reduce((result, r) => ({ ...result, [r.type]: (result[r.type] || 0) + 1 }), {}), assetCount: kind === 'interaction' ? 1 : 0, embedsFixture: true, clipboardFixture: true }
}
