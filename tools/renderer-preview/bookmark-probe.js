import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { createBookmarkGallery, bookmarkVariants } from './bookmark-gallery.js'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }

export async function runBookmarkProbe() {
  const fixture = createBookmarkGallery(), store = createCanvasStore()
  store.loadStoreSnapshot(fixture.snapshot)
  const host = document.createElement('div'); document.body.append(host)
  const before = JSON.stringify(store.getStoreSnapshot()), renderer = mountCanvasRenderer(host, { store })
  const card = variant => host.querySelector(`[data-bookmark="shape:bookmark-${variant}"]`)
  try {
    await settle()
    for (const variant of bookmarkVariants) check(card(variant), `书签未绘制：${variant}`)
    const full = card('full'), title = full.querySelector('[data-bookmark-title]'), description = full.querySelector('[data-bookmark-description]')
    check(title?.textContent.startsWith('合成标题') && description?.textContent.startsWith('合成描述'), '书签正文缺失')
    check(getComputedStyle(title).webkitLineClamp === '2' && getComputedStyle(description).webkitLineClamp === '3', '书签标题或描述没有截断')
    check(full.querySelector('[data-bookmark-image]') && full.querySelector('[data-bookmark-favicon]'), '预览图或网站图标缺失')
    check(full.querySelector('[data-bookmark-url]').textContent === 'very-long-synthetic-subdomain83.something.example.test', '书签没有只显示域名')
    check(!card('no-title').querySelector('[data-bookmark-title]') && card('no-title').querySelector('[data-bookmark-description]'), '缺标题回退丢了描述')
    const noImageShape = fixture.snapshot.store['shape:bookmark-no-image']
    check(!card('no-image').querySelector('img[data-bookmark-image]') && !card('no-image').querySelector('[data-bookmark-preview]') && card('no-image').querySelector('[data-bookmark-description]')?.textContent === fixture.snapshot.store[noImageShape.props.assetId].props.description, '无图卡必须省略图片并逐字保留描述')
    for (const variant of ['empty', 'short']) {
      const shape = fixture.snapshot.store[`shape:bookmark-${variant}`]
      check(!card(variant).querySelector('[data-bookmark-preview]') && !card(variant).querySelector('[data-bookmark-description]') && card(variant).getBoundingClientRect().height === shape.props.h, `空描述的无图卡出现空节点或增高：${variant}`)
    }
    check(!card('no-image-title').querySelector('[data-bookmark-title]') && card('no-image-title').querySelector('[data-bookmark-url]'), '缺图缺标题没有网址')
    for (const variant of ['empty', 'no-favicon', 'missing-asset']) check(card(variant).querySelector('[data-bookmark-link-icon]'), `网站图标回退缺失：${variant}`)
    check(card('short').getBoundingClientRect().height === 46, '网址条没有保留记录高度')
    check(JSON.stringify(store.getStoreSnapshot()) === before, '绘制书签写回了画板')
    const failed = card('no-description').querySelector('[data-bookmark-image]')
    failed.dispatchEvent(new Event('error')); await settle()
    check(!card('no-description').querySelector('[data-bookmark-preview]') && card('no-description').querySelector('[data-bookmark-title]'), '破图没有回退成无图卡片')
    const failedFavicon = full.querySelector('[data-bookmark-favicon]')
    failedFavicon.dispatchEvent(new Event('error')); await settle()
    check(!full.querySelector('[data-bookmark-favicon]') && full.querySelector('[data-bookmark-link-icon]'), '坏网站图标没有回退')
    renderer.setCamera({ x: -20000, y: 100, z: .1 }); await settle()
    renderer.setCamera({ x: 10, y: 10, z: 1.5 }); await settle()
    check(card('full') === full && full.querySelector('[data-bookmark-title]') === title, '平移缩放重建了书签')
    const first = store.get('shape:bookmark-full')
    store.put([{ ...first, x: 40, y: 50, rotation: .3, opacity: .6, props: { ...first.props, w: 360, h: 240 } }]); await settle()
    check(full.style.width === '360px' && full.style.height === '240px' && full.parentElement.style.opacity === '0.6', '书签未应用尺寸及透明度')
    const asset = store.get(first.props.assetId)
    store.put([{ ...asset, props: { ...asset.props, title: '<script>合成文字</script>' } }]); await settle()
    check(card('full').querySelector('[data-bookmark-title]').textContent === '<script>合成文字</script>' && !card('full').querySelector('script'), '书签元数据更新或文字转义失败')
    store.remove([asset.id]); await settle()
    check(card('full').querySelector('[data-bookmark-url]') && !card('full').querySelector('[data-bookmark-title]'), '删除元数据后没有回退到网址')
    store.put([{ ...asset, props: { ...asset.props, image: 'javascript:alert(83)', favicon: 'javascript:alert(84)' } }]); await settle()
    check(!card('full').querySelector('img'), '不可信图片协议被设置为图片来源')
    renderer.unmount(); check(host.children.length === 0, '卸载未释放书签 DOM')
    return { variants: bookmarkVariants.length, lineClamps: true, missingMetadata: true, liveAssetUpdates: true, escapedText: true, cameraKeepsDom: true, geometry: true, noDocumentWrites: true }
  } finally { renderer.unmount(); host.remove() }
}
