import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { getShapeContour } from '../../renderer/geometry.js'
import { createStrokeGallery, strokeProps } from './stroke-fixtures.js'

const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }
const pathOf = points => points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' Z'

export async function runStrokeProbe() {
  const fixture = createStrokeGallery('stroke-styles'), raw = createCanvasStore()
  raw.loadStoreSnapshot(fixture.snapshot)
  const reads = new Set(), listeners = new Set()
  const store = new Proxy(raw, { get(target, key) {
    if (key === 'get') return id => { reads.add(id); return target.get(id) }
    if (key === 'listen') return (...args) => { const off = target.listen(...args), token = {}; listeners.add(token); return () => { off(); listeners.delete(token) } }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const host = document.createElement('div'); document.body.append(host)
  const before = JSON.stringify(raw.getStoreSnapshot()), renderer = mountCanvasRenderer(host, { store })
  try {
    await settled()
    check(JSON.stringify(raw.getStoreSnapshot()) === before, '笔迹挂载修改了模型')
    let contours = 0
    for (const record of Object.values(fixture.snapshot.store).filter(r => r.type === 'draw')) {
      const paths = [...host.querySelectorAll(`[data-shape-id="${record.id}"] [data-stroke-outline]`)]
      const expected = getShapeContour(record).outlines.map(pathOf)
      // Explicit M/L/Z commands permit whitespace omission. Keep this independent
      // coordinate serializer, comparing every coordinate without formatting noise.
      check(JSON.stringify(paths.map(path => path.getAttribute('d').replaceAll(' ', ''))) === JSON.stringify(expected.map(path => path.replaceAll(' ', ''))), '绘制与点中使用的笔迹轮廓分叉')
      const element = host.querySelector(`[data-shape-id="${record.id}"]`), svg = element.querySelector('svg')
      check(Math.abs(element.getBoundingClientRect().top - svg.getBoundingClientRect().top) < 0.01, '短笔迹被 SVG 行内基线向下推离模型位置')
      contours++
    }
    const first = raw.get('shape:stroke-1'), other = host.querySelector('[data-shape-id="shape:stroke-2"]')
    const original = host.querySelector(`[data-shape-id="${first.id}"] [data-stroke-outline]`).getAttribute('d')
    reads.clear()
    raw.put([{ ...first, opacity: 0.4, props: { ...first.props, size: 'xl', color: 'red' } }]); await settled()
    check(reads.size === 1 && reads.has(first.id), '笔迹记录更新误读了其他形状')
    const element = host.querySelector(`[data-shape-id="${first.id}"]`), ink = element.querySelector('[data-stroke-outline]')
    check(ink.getAttribute('d') !== original && ink.parentElement.getAttribute('fill') === '#e03131' && element.style.opacity === '0.4', '记录更新未刷新粗细、颜色或透明度')
    check(host.querySelector('[data-shape-id="shape:stroke-2"]') === other, '更新笔迹替换了无关 DOM')
    const highlighter = { ...first, id: 'shape:probe-highlight', type: 'highlight', x: 20, y: 20, opacity: 1, props: strokeProps('highlight') }
    raw.put([highlighter]); await settled()
    check(host.querySelector('[data-shape-id="shape:probe-highlight"] [data-stroke-layer="foreground"] g').getAttribute('opacity') === '0.35', '荧光笔前景透明度不符')
    check(host.querySelector('[data-renderer-background="shape:probe-highlight"] [data-stroke-layer="background"] g').getAttribute('opacity') === '0.82', '荧光笔独立背景层缺失')
    const second = { ...highlighter, id: 'shape:probe-highlight-2', index: 'aZ' }
    raw.put([second]); await settled()
    const neighbor = host.querySelector('[data-renderer-background="shape:probe-highlight-2"]')
    reads.clear()
    raw.put([{ ...highlighter, props: { ...highlighter.props, size: 'xl', color: 'blue' } }]); await settled()
    check(reads.size === 1 && reads.has(highlighter.id), '单条荧光笔更新误读了其他背景或形状')
    check(host.querySelector('[data-renderer-background="shape:probe-highlight-2"]') === neighbor, '更新荧光笔重画了别人的背景')
    const background = host.querySelector('[data-renderer-background="shape:probe-highlight"]')
    check(background.compareDocumentPosition(neighbor) & Node.DOCUMENT_POSITION_FOLLOWING, '背景顺序没有保留形状层级')
    check(neighbor.compareDocumentPosition(host.querySelector('[data-shape-id="shape:stroke-1"]')) & Node.DOCUMENT_POSITION_FOLLOWING, '背景没有先于正常内容绘制')
    const group = { ...first, id: 'shape:probe-ink-group', type: 'group', x: 10, y: 15, rotation: 0.2, opacity: 0.5, props: {} }
    raw.put([group, { ...highlighter, parentId: group.id }, { ...second, parentId: group.id }]); await settled()
    const groupBackgrounds = host.querySelectorAll('[data-renderer-background="shape:probe-ink-group"]')
    check(groupBackgrounds.length === 1 && groupBackgrounds[0].style.opacity === '0.5', '半透明组的背景未共享同一合成边界')
    check(groupBackgrounds[0].querySelectorAll('[data-stroke-layer="background"]').length === 2, '半透明组丢失子笔迹背景')
    const frame = { ...first, id: 'shape:probe-ink-frame', type: 'frame', x: 200, y: 100, opacity: 1, props: { w: 100, h: 80, name: '', color: 'black' } }
    raw.put([frame, { ...highlighter, parentId: frame.id, x: 80 }]); await settled()
    const clip = host.querySelector('[data-frame-clip="shape:probe-ink-frame"]')
    check(clip?.style.overflow === 'hidden' && clip.contains(host.querySelector('[data-renderer-background="shape:probe-highlight"]')), '荧光笔背景没有随画框裁切')
    reads.clear(); renderer.setCamera({ x: 20, y: -10, z: 2 }); await settled()
    check(reads.size === 0, '相机更新重新读取了笔迹或背景')
    raw.remove([highlighter.id]); await settled()
    check(!host.querySelector('[data-renderer-background="shape:probe-highlight"]'), '删除笔迹遗留背景')
    renderer.unmount(); check(listeners.size === 0 && host.children.length === 0, '卸载笔迹遗留订阅或 DOM')
    reads.clear(); raw.put([{ ...second, x: second.x + 20, index: 'ab' }]); await settled()
    check(reads.size === 0 && host.children.length === 0, '卸载后笔迹或背景仍响应更新')
    return { sharedContours: contours, recordUpdateIsolated: true, highlightLayers: true, backgroundOrder: true, highlightUpdateIsolated: true, frameClipping: true, cameraDoesNotReadRecords: true, subscriptionsReleased: true }
  } finally { renderer.unmount(); host.remove() }
}
