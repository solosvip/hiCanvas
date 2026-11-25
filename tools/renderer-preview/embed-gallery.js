import { toRichText } from '@tldraw/tlschema'
import { getIndexAbove } from '@tldraw/utils'
import { createCanvasSnapshot } from '../../model/index.js'

// All HTML and URLs below are synthetic; no external page is opened.
export const inlinePage = (title, color = '#315f65') => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}body{box-sizing:border-box;background:${color};color:white;font:24px system-ui;padding:40px}h1{font-size:48px;margin:16px 0}p{line-height:1.6}</style><body><small>hiCanvas · 本机合成内容</small><h1>${title}</h1><p>640 × 360<br>中文、内联样式与脚本均已载入</p><script>document.documentElement.dataset.instance = Math.random().toString(36)</script></body></html>`)

export function createEmbedGallery() {
  const snapshot = createCanvasSnapshot(), store = snapshot.store
  const pageId = Object.values(store).find(record => record.typeName === 'page').id
  const counts = { embed: 0, bookmark: 0, frame: 0, text: 0 }
  let index = 'a0', serial = 0
  const add = (id, type, x, y, props, meta = {}, parentId = pageId, extra = {}) => {
    store[id] = { id, typeName: 'shape', type, x, y, props, meta, parentId, index, isLocked: false, opacity: 1, rotation: 0, ...extra }
    index = getIndexAbove(index); serial++; counts[type]++
  }
  const label = (id, title, x, y) => add(`shape:label-${id}`, 'text', x, y, { richText: toRichText(title), color: 'black', size: 's', font: 'mono', scale: 1, w: 640, autoSize: false, textAlign: 'start' })
  const embed = (id, title, x, y, meta = {}, parentId, extra) => add(`shape:${id}`, 'embed', x, y, { w: 640, h: 360, url: inlinePage(title, meta.cowartFilm ? '#22283a' : meta.cowartAiSlidesParentShapeId ? '#745333' : '#315f65') }, { cowartHtmlDraft: true, ...meta }, parentId, extra)
  label('web', '网页 / 640 × 360', 40, 20)
  embed('embed-web', '网页', 40, 70)
  label('film', '影片 / 旋转 0.04 / 透明度 85%', 740, 20)
  embed('embed-film', '影片 · 静态首帧', 740, 70, { cowartFilm: true }, undefined, { rotation: .04, opacity: .85 })
  label('slides', '幻灯片画框 + HTML 页片', 40, 480)
  add('shape:embed-slides', 'frame', 40, 535, { w: 640, h: 360, name: '合成幻灯片', color: 'blue' }, { cowartAiSlides: true })
  embed('embed-slide', '幻灯片 · 第 1 页', 0, 0, { cowartAiSlidesParentShapeId: 'shape:embed-slides' }, 'shape:embed-slides')
  add('shape:embed-external', 'embed', 740, 535, { w: 300, h: 155, url: 'https://example.invalid/external' })
  add('shape:embed-bookmark', 'bookmark', 1080, 535, { w: 300, h: 155, url: 'https://example.invalid/bookmark', assetId: 'asset:embed-bookmark' })
  store['asset:embed-bookmark'] = { id: 'asset:embed-bookmark', typeName: 'asset', type: 'bookmark', meta: {}, props: { title: '合成书签', description: '仅展示元数据', image: '', favicon: '', src: 'https://example.invalid/bookmark' } }
  add('shape:embed-error', 'embed', 740, 735, { w: 300, h: 160, url: 'data:text/html,' }, { cowartHtmlDraft: true })
  add('shape:embed-missing', 'embed', 1080, 735, { w: 300, h: 160, url: '' }, { cowartHtmlDraft: true })
  for (const [i, status] of ['queued', 'running', 'failed', 'interrupted', 'pending', 'working', 'waiting', 'saved'].entries()) {
    add(`shape:state-${status}`, 'frame', 40 + i % 4 * 350, 980 + Math.floor(i / 4) * 210, { w: 290, h: 155, name: '生成状态', color: 'blue' }, { hicanvasGeneration: { status, ...(status === 'failed' ? { error: '合成错误：请重试' } : {}) } })
  }
  return { snapshot, viewState: { currentPageId: pageId, camera: { x: 15, y: 70, z: .55 } }, count: serial, counts, assetCount: 0 }
}
