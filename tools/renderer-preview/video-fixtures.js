import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { base64 as mp4 } from './video-data-grid-mp4.js'
import { base64 as webm } from './video-data-grid-webm.js'

export const videoData = { mp4: `data:video/mp4;base64,${mp4}`, webm: `data:video/webm;base64,${webm}` }
export function addVideoLoad(metadata, amount = 3) {
  const snapshot = structuredClone(metadata.snapshot), shapes = Object.values(snapshot.store).filter(r => r.typeName === 'shape' && r.type === 'image').slice(0, amount)
  if (shapes.length !== amount) throw new Error('视频对照需要等量图片占位。')
  snapshot.store['asset:video-perf'] = { id: 'asset:video-perf', typeName: 'asset', type: 'video', props: { src: videoData.mp4, name: 'Synthetic video', w: 320, h: 180, mimeType: 'video/mp4', isAnimated: true }, meta: {} }
  for (const shape of shapes) snapshot.store[shape.id] = { ...shape, type: 'video', props: { w: shape.props.w, h: shape.props.h, assetId: 'asset:video-perf', time: 0, playing: true, autoplay: true, url: '', altText: '' } }
  return { ...metadata, snapshot, counts: { ...metadata.counts, image: metadata.counts.image - amount, video: amount }, assetCount: metadata.assetCount + 1, videoFixture: true }
}
export function createVideoFixture(initial = createCanvasSnapshot()) {
  const commands = []
  for (const [i, src] of [videoData.mp4, videoData.webm, null, 'https://example.invalid/forbidden.mp4', videoData.mp4].entries()) {
    const assetId = `asset:video-${i}`, id = `shape:video-${i}`
    if (src) commands.push({ type: 'put', record: { id: assetId, typeName: 'asset', type: 'video', props: { src, name: 'Synthetic colour grid', w: 320, h: 180, mimeType: i === 1 ? 'video/webm' : 'video/mp4', isAnimated: true }, meta: {} } })
    // Legacy flags deliberately remain true: #186 must ignore them without
    // migrating the saved document. Three valid clips must display paused frames.
    commands.push({ type: 'create_shape', id, shapeType: 'video', x: i === 4 ? 950 : 100 + i % 2 * 420, y: i === 4 ? 420 : 100 + Math.floor(i / 2) * 320, props: { w: 320, h: i === 1 ? 240 : 180, assetId: src ? assetId : null, time: i === 0 ? 1.25 : i === 1 ? .5 : 0, playing: true, autoplay: true } })
  }
  commands.push({ type: 'create_shape', id: 'shape:video-unrelated', shapeType: 'geo', x: 950, y: 100, props: { w: 80, h: 60 } })
  const snapshot = executeCanvasCommands(initial, commands).snapshot, pageId = Object.values(snapshot.store).find(r => r.typeName === 'page').id
  return { snapshot, count: 6, counts: { video: 5, geo: 1 }, assetCount: 4, videoFixture: true, viewState: { version: 1, currentPageId: pageId, camera: { x: 0, y: 0, z: 1 } } }
}
