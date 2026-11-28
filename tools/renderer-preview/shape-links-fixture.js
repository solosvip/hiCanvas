import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { videoData } from './video-fixtures.js'
import { imageGrid } from './image-fixtures.js'

export function createShapeLinksFixture() {
  const commands = [], url = name => `https://example.invalid/links/${name}`
  const add = (id, shapeType, x, y, props = {}, other = {}) => commands.push({ type: 'create_shape', id: `shape:link-${id}`, shapeType, x, y, props, ...other })
  add('geo', 'geo', 80, 100, { w: 220, h: 140, fill: 'solid', url: url('geo') })
  add('note', 'note', 390, 100, { url: url('note') }, { text: '合成便签' })
  commands.push({ type: 'put', record: { id: 'asset:link-image', typeName: 'asset', type: 'image', meta: {}, props: { src: imageGrid, name: '合成图片', w: 240, h: 180, mimeType: 'image/svg+xml', isAnimated: false } } })
  add('image', 'image', 680, 100, { w: 180, h: 140, assetId: 'asset:link-image', url: url('image') })
  commands.push({ type: 'put', record: { id: 'asset:link-video', typeName: 'asset', type: 'video', meta: {}, props: { src: videoData.mp4, name: '合成视频', w: 320, h: 180, mimeType: 'video/mp4', isAnimated: true } } })
  add('video', 'video', 930, 100, { w: 240, h: 135, assetId: 'asset:link-video', url: url('video') })
  add('frame', 'frame', 80, 410, { w: 230, h: 150, name: '链接随画框裁切' })
  add('clipped', 'geo', 150, 15, { w: 100, h: 100, fill: 'solid', url: url('clipped') }, { parentId: 'shape:link-frame' })
  add('group', 'group', 440, 400, {}, { rotation: .2 })
  add('child', 'geo', 0, 0, { w: 160, h: 110, fill: 'solid', url: url('child') }, { parentId: 'shape:link-group', rotation: .3 })
  add('sibling', 'geo', 180, 10, { w: 80, h: 80 }, { parentId: 'shape:link-group' })
  add('locked', 'geo', 780, 430, { w: 150, h: 110, fill: 'solid', url: url('locked') })
  commands.push({ type: 'update', id: 'shape:link-locked', changes: { isLocked: true } })
  add('text', 'text', 1000, 440, {}, { text: '文本不支持附加链接' })
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot, shapes = Object.values(snapshot.store).filter(r => r.typeName === 'shape')
  return { snapshot, count: shapes.length, counts: shapes.reduce((counts, r) => ({ ...counts, [r.type]: (counts[r.type] || 0) + 1 }), {}), assetCount: 2,
    shapeLinksFixture: true, clipboardFixture: true, viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
}
