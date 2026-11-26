import { getIndexAbove } from '@tldraw/utils'
import { createCanvasSnapshot } from '../../model/index.js'

const picture = (text, color, w, h) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/><text x="8" y="24" fill="white">${text}</text></svg>`)
export const bookmarkVariants = ['full', 'no-image', 'no-title', 'no-image-title', 'empty', 'no-favicon', 'no-description', 'missing-asset', 'short']

export function createBookmarkGallery() {
  const snapshot = createCanvasSnapshot(), store = snapshot.store
  const pageId = Object.values(store).find(record => record.typeName === 'page').id
  let index = 'a1'
  bookmarkVariants.forEach((variant, i) => {
    const id = `shape:bookmark-${variant}`, assetId = `asset:bookmark-${variant}`
    const props = {
      src: 'https://very-long-synthetic-subdomain83.something.example.test/a/path',
      title: '合成标题 Synthetic title with many words and a very long continuation that should be truncated in the bookmark card',
      description: '合成描述 Synthetic description with several sentences. This is purely local fixture content to observe line clamping and overflow. '.repeat(5),
      image: picture('SYNTHETIC PREVIEW', '#275078', 600, 300), favicon: picture('F', '#915279', 32, 32)
    }
    if (['no-image', 'no-image-title', 'empty', 'short'].includes(variant)) props.image = ''
    if (['no-title', 'no-image-title', 'empty', 'short'].includes(variant)) props.title = ''
    if (['no-description', 'empty', 'short'].includes(variant)) props.description = ''
    if (['no-favicon', 'empty', 'short'].includes(variant)) props.favicon = ''
    if (variant !== 'missing-asset') store[assetId] = { id: assetId, typeName: 'asset', type: 'bookmark', meta: {}, props }
    store[id] = { id, typeName: 'shape', type: 'bookmark', x: 20 + i % 3 * 340, y: 90 + Math.floor(i / 3) * 350, rotation: 0, index, parentId: pageId, isLocked: false, opacity: 1, meta: {}, props: { w: 300, h: variant === 'short' ? 46 : 320, url: props.src, assetId } }
    index = getIndexAbove(index)
  })
  return { snapshot, viewState: { currentPageId: pageId, camera: { x: 15, y: 15, z: .7 } }, count: bookmarkVariants.length, counts: { bookmark: bookmarkVariants.length }, assetCount: bookmarkVariants.length - 1 }
}
