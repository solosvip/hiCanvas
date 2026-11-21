import { AssetRecordType, createShapeId } from 'tldraw'
import { imageApi } from './client.js'

function dimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight })
    image.onerror = () => reject(new Error('结果已保存，但图片未能载入。可在“模型设置 → 最近生成”中找回或下载。'))
    image.src = src
  })
}

export async function insertGeneratedImages(editor, images, { anchorId, pageId = editor.getCurrentPageId(), beside = false } = {}) {
  const loaded = await Promise.all(images.map(async image => ({ ...image, ...await dimensions(image.src) })))
  if (!editor.getPage(pageId) || (anchorId && (!editor.getShape(anchorId) || editor.getAncestorPageId(anchorId) !== pageId))) throw new Error('原页面或图片框已被删除。结果已保存，请在“模型设置 → 最近生成”中找回。')
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
  const result = await imageApi('/api/images', 'POST', { modelId, prompt, references })
  await insertGeneratedImages(editor, result.images, { anchorId, pageId, beside })
  return result
}
