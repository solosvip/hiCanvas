import { AssetRecordType, createShapeId } from 'tldraw'
import { imageApi } from './client.js'
import { saveCowartEditorSnapshot } from '../cowartCanvasSave.js'

function dimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight })
    image.onerror = () => reject(new Error('结果已保存，但图片未能载入。可在“菜单栏 → 图片结果”中找回或下载。'))
    image.src = src
  })
}

export async function insertGeneratedImages(editor, images, { anchorId, pageId = editor.getCurrentPageId(), beside = false } = {}) {
  const loaded = await Promise.all(images.map(async image => ({ ...image, ...await dimensions(image.src) })))
  if (!editor.getPage(pageId) || (anchorId && (!editor.getShape(anchorId) || editor.getAncestorPageId(anchorId) !== pageId))) throw new Error('原图片框已被删除。结果已保存，请在“菜单栏 → 图片结果”中找回。')
  const anchor = anchorId ? editor.getShapePageBounds(anchorId) : null
  const viewport = editor.getViewportPageBounds()
  let x = anchor ? anchor.x + (beside ? anchor.w + 40 : 0) : viewport.center.x
  const y = anchor ? anchor.y : viewport.center.y
  const assets = [], shapes = []
  for (const image of loaded) {
    const assetId = AssetRecordType.createId()
    const width = anchor?.w || Math.min(image.w, 512)
    const height = image.h / image.w * width
    assets.push({ id: assetId, typeName: 'asset', type: 'image', props: { name: image.src.split('/').pop(), src: image.src, w: image.w, h: image.h, mimeType: 'image/' + (image.src.endsWith('.jpg') ? 'jpeg' : image.src.split('.').pop()), isAnimated: false }, meta: {} })
    shapes.push({ id: createShapeId(), type: 'image', parentId: pageId, x, y, props: { assetId, w: width, h: height } })
    x += width + 40
  }
  editor.run(() => {
    editor.createAssets(assets)
    editor.createShapes(shapes)
  })
  if (editor.getCurrentPageId() === pageId) editor.select(...shapes.map(shape => shape.id))
  return shapes.map(shape => shape.id)
}

export async function generateOnCanvas(editor, { anchorId, modelId, prompt, references = [], beside = false, pageId = editor.getCurrentPageId() }) {
  const saved = await saveCowartEditorSnapshot(editor)
  if (saved?.ok === false) throw new Error(saved.message || '画板尚未保存，未调用生图。')
  const state = await imageApi('/api/canvas')
  const anchor = anchorId ? state.snapshot.store[anchorId] : null
  if (anchorId && !anchor) throw new Error('原目标已删除，未调用生图。')
  const bounds = anchorId ? editor.getShapePageBounds(anchorId) : null
  const width = Math.round(bounds?.w || 512), height = Math.round(bounds?.h || 512)
  return imageApi('/api/images/jobs', 'POST', {
    expectedRevision: state.revision, modelId, pageId,
    anchorShapeId: anchorId, displayWidth: width, displayHeight: height,
    ...(beside && bounds ? { x: bounds.x + width + 40, y: bounds.y } : {}),
    requests: [{ prompt, references, aspectRatio: `${width}:${height}` }]
  })
}
