import test from 'node:test'
import assert from 'node:assert/strict'
import { insertGeneratedImages } from '../src/image-models/canvasImages.js'

const originalImage = globalThis.Image
function editorBoundary(t, { missingPage = false, missingAnchor = false } = {}) {
  globalThis.Image = class { set src(_) { this.naturalWidth = 128; this.naturalHeight = 96; queueMicrotask(() => this.onload()) } }
  t.after(() => { globalThis.Image = originalImage })
  const assets = [], shapes = [], selected = []
  return { assets, shapes, selected, editor: {
    getCurrentPageId: () => 'page:current', getPage: () => missingPage ? undefined : {},
    getShape: () => missingAnchor ? undefined : {},
    getAncestorPageId: () => "page:original",
    getShapePageBounds: () => ({ x: 100, y: 200, w: 512, h: 683 }),
    getViewportPageBounds: () => ({ center: { x: 600, y: 400 } }),
    run: callback => callback(), createAssets: values => assets.push(...values), createShapes: values => shapes.push(...values),
    select: (...ids) => selected.push(...ids)
  } }
}

test('两次生成的图片使用不同文件名，避免保存时互相覆盖；比例保持不变', async t => {
  const { editor, assets, shapes } = editorBoundary(t)
  await insertGeneratedImages(editor, [{ src: '/assets/generated-first.png' }, { src: '/assets/generated-second.png' }], { anchorId: 'shape:holder', pageId: 'page:original' })
  assert.deepEqual(assets.map(asset => asset.props.name), ['generated-first.png', 'generated-second.png'])
  assert.deepEqual(shapes.map(shape => [shape.props.w, shape.props.h]), [[512, 384], [512, 384]])
})

test('生成期间切到别页，仍放回原页且不切走用户选择；原页或框已删除则保留结果并提示找回', async t => {
  const { editor, shapes, selected } = editorBoundary(t)
  await insertGeneratedImages(editor, [{ src: '/assets/generated-first.png' }], { pageId: 'page:original', anchorId: 'shape:holder' })
  assert.equal(shapes[0].parentId, 'page:original')
  assert.deepEqual(selected, [])
  const removed = editorBoundary(t, { missingPage: true })
  await assert.rejects(insertGeneratedImages(removed.editor, [{ src: '/assets/generated-second.png' }], { pageId: 'page:original', anchorId: 'shape:holder' }), /最近生成/)
  assert.equal(removed.shapes.length, 0)
  const removedAnchor = editorBoundary(t, { missingAnchor: true })
  await assert.rejects(insertGeneratedImages(removedAnchor.editor, [{ src: '/assets/generated-third.png' }], { pageId: 'page:original', anchorId: 'shape:holder' }), /最近生成/)
  assert.equal(removedAnchor.shapes.length, 0)
})
