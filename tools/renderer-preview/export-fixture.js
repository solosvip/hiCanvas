import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { videoData } from './video-fixtures.js'

const htmlUrl = html => 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
export const exportWebHtml = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:rgb(28,72,112);color:white;font:24px system-ui}b{position:absolute;right:0;bottom:0;background:rgb(239,56,0);width:40px;height:40px}</style><body>WEB 中文 pixels<b></b></body>'
export const exportNetworkTarget = 'https://export-observation.example.invalid/content.png'
const film = '<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:rgb(185,32,48)}#mark{position:absolute;top:60px;left:0;width:40px;height:40px;background:rgb(32,239,96)}</style><div id="mark"></div><script>const motion=document.querySelector("#mark").animate([{transform:"translateX(0px)"},{transform:"translateX(160px)"}],{duration:2000,fill:"both"});motion.pause();window.CowartFilm={seek(t){motion.currentTime=t*1000},play(){motion.play()},pause(){motion.pause()},setMuted(){},getDuration(){return 2}}</script>'
const entrance = '<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:rgb(28,72,112)}#mark{position:absolute;top:60px;left:60px;width:80px;height:80px;background:rgb(32,239,96);opacity:0}</style><div id="mark"></div><script>document.querySelector("#mark").animate([{opacity:0},{opacity:1}],{duration:10,fill:"forwards"}).finish()</script>'
const quadrants = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><path fill="red" d="M0 0H120V90H0Z"/><path fill="lime" d="M120 0H240V90H120Z"/><path fill="blue" d="M0 90H120V180H0Z"/><path fill="yellow" d="M120 90H240V180H120Z"/></svg>'

// This snapshot is rendered directly, never mounted as a browsing document:
// the test measures export requests without first requesting its external media.
export function createExternalExportFixture() {
  const initial = createCanvasSnapshot(), pageId = Object.values(initial.store).find(record => record.typeName === 'page').id
  return executeCanvasCommands(initial, [
    { type: 'put', record: { id: 'asset:external-image', typeName: 'asset', type: 'image', meta: {}, props: { name: 'External image', src: 'https://export-observation.example.invalid/image.png', w: 160, h: 160, mimeType: 'image/png', isAnimated: false } } },
    { type: 'create_shape', id: 'shape:external-image', shapeType: 'image', x: 50, y: 100, props: { w: 160, h: 160, assetId: 'asset:external-image' } },
    { type: 'put', record: { id: 'asset:external-card', typeName: 'asset', type: 'bookmark', meta: {}, props: { src: 'https://synthetic.invalid', title: 'Synthetic bookmark', description: '', image: 'https://export-observation.example.invalid/preview.png', favicon: 'https://export-observation.example.invalid/favicon.png' } } },
    { type: 'put', record: { id: 'shape:external-card', typeName: 'shape', type: 'bookmark', x: 300, y: 100, rotation: 0, index: 'a2', parentId: pageId, isLocked: false, opacity: 1, meta: {}, props: { w: 320, h: 320, url: 'https://synthetic.invalid', assetId: 'asset:external-card' } } },
  ]).snapshot
}

export function createExportFixture(initial = createCanvasSnapshot(), kind = 'static') {
  const commands = [], add = (id, shapeType, x, y, props = {}, meta) => commands.push({ type: 'create_shape', id: `shape:export-${id}`, shapeType, x, y, props, ...(meta && { meta }) })
  if (kind === 'static') {
    add('left', 'geo', 200, 240, { w: 200, h: 100, dash: 'solid', size: 'm', color: 'blue', fill: 'solid' })
    add('right', 'geo', 620, 410, { w: 200, h: 100, dash: 'solid', size: 'm', color: 'red', fill: 'solid' })
  } else if (kind === 'text') {
    commands.push({ type: 'create_shape', id: 'shape:export-text', shapeType: 'text', x: 60, y: 100, text: '中文 😀\nBold italic text', props: { w: 200, autoSize: false, font: 'sans' } })
    commands.push({ type: 'create_shape', id: 'shape:export-note', shapeType: 'note', x: 350, y: 100, text: '合成便签\nSynthetic note' })
    add('empty-note', 'note', 600, 100)
    add('frame', 'frame', 80, 420, { w: 180, h: 120, name: '框 title' })
    add('child', 'geo', 150, 30, { w: 120, h: 80, dash: 'draw', fill: 'pattern' })
    add('opacity', 'geo', 900, 600, { w: 40, h: 40, dash: 'solid' })
    add('label', 'arrow', 400, 500, { start: { x: 0, y: 0 }, end: { x: 240, y: 80 }, color: 'green' })
  } else if (kind === 'media') {
    commands.push({ type: 'put', record: { id: 'asset:export-image', typeName: 'asset', type: 'image', meta: {}, props: { name: 'Synthetic quadrant', src: 'data:image/svg+xml,' + encodeURIComponent(quadrants), w: 240, h: 180, mimeType: 'image/svg+xml', isAnimated: false } } })
    commands.push({ type: 'put', record: { id: 'asset:export-video', typeName: 'asset', type: 'video', meta: {}, props: { name: 'Synthetic video', src: videoData.mp4, w: 320, h: 180, mimeType: 'video/mp4', isAnimated: true } } })
    add('image', 'image', 70, 420, { w: 180, h: 180, assetId: 'asset:export-image', flipX: true, crop: { topLeft: { x: .25, y: 0 }, bottomRight: { x: 1, y: 1 } } })
    add('video', 'video', 350, 420, { w: 320, h: 180, assetId: 'asset:export-video', time: .5, playing: false })
    add('web', 'embed', 70, 140, { w: 320, h: 200, url: htmlUrl(exportWebHtml) }, { cowartHtmlDraft: true })
    add('film', 'embed', 470, 140, { w: 320, h: 200, url: htmlUrl(film) }, { cowartHtmlDraft: true, cowartFilm: true, cowartFilmDuration: 2 })
    add('slide', 'embed', 850, 140, { w: 200, h: 200, url: htmlUrl(exportWebHtml.replace('WEB 中文 pixels', 'PAGE 2')) }, { cowartHtmlDraft: true, cowartAiSlidesParentShapeId: 'shape:export-slides' })
  } else if (kind === 'animation') {
    add('entrance', 'embed', 70, 140, { w: 320, h: 200, url: htmlUrl(entrance) }, { cowartHtmlDraft: true })
    add('film', 'embed', 470, 140, { w: 320, h: 200, url: htmlUrl(film) }, { cowartHtmlDraft: true, cowartFilm: true, cowartFilmDuration: 2 })
  } else if (kind === 'network') {
    const html = exportWebHtml + `<img crossorigin="anonymous" src="${exportNetworkTarget}" style="position:absolute;left:100px;top:100px;width:20px;height:20px">`
    add('network', 'embed', 70, 140, { w: 320, h: 200, url: htmlUrl(html) }, { cowartHtmlDraft: true })
  } else if (kind === 'decorations') {
    add('under-title', 'geo', 430, 180, { w: 40, h: 16, color: 'red', fill: 'solid', dash: 'solid' })
    add('wide-frame', 'frame', 70, 200, { w: 800, h: 120, name: 'A' })
    commands.push({ type: 'put', record: { id: 'asset:export-card', typeName: 'asset', type: 'bookmark', meta: {}, props: { src: 'https://synthetic.invalid', title: 'A long synthetic title with a SECOND line of visible words', description: 'A synthetic description that must wrap to a second and a third line so that visible words are not lost from the exported card.', image: 'data:image/svg+xml,' + encodeURIComponent(quadrants), favicon: '' } } })
    commands.push({ type: 'put', record: { id: 'shape:export-card', typeName: 'shape', type: 'bookmark', x: 70, y: 400, rotation: 0, index: 'a3', parentId: Object.values(initial.store).find(record => record.typeName === 'page').id, isLocked: false, opacity: 1, meta: {}, props: { w: 320, h: 320, assetId: 'asset:export-card', url: 'https://synthetic.invalid' } } })
  } else if (!['empty', 'external'].includes(kind)) throw new Error('未知输出夹具。')
  const snapshot = commands.length ? executeCanvasCommands(initial, commands).snapshot : initial
  if (kind === 'text') {
    snapshot.store['shape:export-child'].parentId = 'shape:export-frame'
    snapshot.store['shape:export-frame'].rotation = .2
    snapshot.store['shape:export-opacity'].opacity = 0
    for (const id of ['shape:export-note', 'shape:export-empty-note']) snapshot.store[id].props.textFirstEditedBy = 'synthetic'
    snapshot.store['user:synthetic'] = { id: 'user:synthetic', typeName: 'user', name: 'Synthetic Longname', color: 'blue', imageUrl: '', meta: {} }
    snapshot.store['shape:export-text'].props.richText.content[1].content[0].marks = [{ type: 'bold' }, { type: 'italic' }]
  }
  const shapes = Object.values(snapshot.store).filter(r => r.typeName === 'shape')
  // The preview's count assertion measures mounted wrappers; the existing
  // renderer omits opacity=0 wrappers, while export must retain their bounds.
  return { snapshot, count: shapes.filter(shape => shape.opacity !== 0).length, documentCount: shapes.length, counts: Object.fromEntries([...new Set(shapes.map(s => s.type))].map(type => [type, shapes.filter(s => s.type === type).length])), assetCount: Object.values(snapshot.store).filter(r => r.typeName === 'asset').length, exportFixture: kind, viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id, camera: { x: 0, y: 0, z: 1 } } }
}
