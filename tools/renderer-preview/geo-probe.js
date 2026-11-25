import { DefaultColorStyle, GeoShapeGeoStyle } from '@tldraw/tlschema'
import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { getShapeContour } from '../../renderer/geometry.js'
import { createGallery } from './gallery.js'

const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, label) => { if (!condition) throw new Error(label) }

export async function runGeoProbe() {
  const fixture = createGallery('shapes'), store = createCanvasStore()
  store.loadStoreSnapshot(fixture.snapshot)
  const host = document.createElement('div')
  document.body.append(host)
  const renderer = mountCanvasRenderer(host, { store, pageId: fixture.viewState.currentPageId })
  const id = Object.values(fixture.snapshot.store).find(record => record.type === 'geo').id
  const update = async (props, opacity = 1) => {
    const before = store.get(id)
    store.put([{ ...before, opacity, props: { ...before.props, ...props } }])
    await settled()
    return host.querySelector(`[data-shape-id="${id}"]`)
  }
  try {
    await settled()
    for (const geo of GeoShapeGeoStyle.values) {
      const element = await update({ geo, w: 160, h: 100, growY: 20 })
      const points = getShapeContour(store.get(id)).outline
      const expected = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' Z'
      check(element.querySelector('[data-geo-outline]').getAttribute('d') === expected, `${geo} 渲染与命中轮廓分叉`)
      check(element.querySelector('svg').getAttribute('height') === '120', `${geo} 忽略 growY`)
    }
    // Expected observations from the independently sampled light-theme sheet.
    const strokes = ['#1d1d1d', '#9fa8b2', '#e085f4', '#ae3ec9', '#4465e9', '#4ba1f1', '#f1ac4b', '#e16919', '#099268', '#4cb05e', '#f87777', '#e03131', '#ffffff']
    const label = Object.values(fixture.snapshot.store).find(record => record.type === 'text')
    for (let i = 0; i < DefaultColorStyle.values.length; i++) {
      const color = DefaultColorStyle.values[i]
      store.put([{ ...label, props: { ...label.props, color } }])
      const element = await update({ color })
      check(element.querySelector('[data-geo-outline]').getAttribute('stroke') === strokes[i], '描边颜色与取色证据不符')
      check(host.querySelector(`[data-shape-id="${label.id}"] g`).getAttribute('fill') === strokes[i], '文字颜色与取色证据不符')
    }
    const fills = { none: 'none', semi: '#fcfffe', solid: '#dce1f8', fill: '#4465e9', pattern: null, 'lined-fill': null }
    for (const [fill, expected] of Object.entries(fills)) {
      const element = await update({ geo: 'rectangle', fill, color: 'blue' })
      const value = element.querySelector('[data-geo-outline]').getAttribute('fill')
      if (['pattern', 'lined-fill'].includes(fill)) {
        const pattern = element.querySelector('pattern')
        check(pattern && value === `url(#${pattern.id})` && pattern.getAttribute('patternUnits') === 'userSpaceOnUse', `${fill} 图案引用失效`)
      } else check(value === expected, `${fill} 填充与取色证据不符`)
    }
    const widths = []
    for (const size of ['s', 'm', 'l', 'xl']) widths.push(Number((await update({ size })).querySelector('[data-geo-outline]').getAttribute('stroke-width')))
    check(widths.join(',') === '1.5,2.5,4,6', '四档线宽无效')
    const dashed = await update({ dash: 'dashed', size: 'm' })
    check(dashed.querySelector('[data-geo-outline]').getAttribute('stroke-dasharray') === '7.5 5', '虚线间距无效')
    const draw = await update({ dash: 'draw' })
    check(!draw.querySelector('[data-geo-outline]').hasAttribute('stroke-dasharray'), 'draw 未按实线绘制')
    const before = (await update({ color: 'blue', size: 's', dash: 'solid', scale: 1 })).querySelector('[data-geo-outline]')
    const blue = before.getAttribute('stroke'), thin = Number(before.getAttribute('stroke-width'))
    const after = await update({ color: 'red', size: 'xl', dash: 'dotted', scale: 2 }, 0.4)
    const path = after.querySelector('[data-geo-outline]')
    check(path.getAttribute('stroke') !== blue && Number(path.getAttribute('stroke-width')) > thin, '颜色或线宽没有随记录更新')
    check(path.getAttribute('stroke-dasharray') === '0 24' && after.style.opacity === '0.4', '圆点间距或透明度没有更新')
    await update({}, 0)
    check(!host.querySelector(`[data-shape-id="${id}"]`), '透明度为零仍绘制形状')
    return { sharedContours: 20, fillModes: 6, growY: true, recordStyles: true, opacity: true }
  } finally { renderer.unmount(); host.remove() }
}
