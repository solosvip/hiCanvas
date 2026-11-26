import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { getShapeBounds, getTextLayoutStats, measureText } from '../../renderer/geometry.js'
import { createNoteGallery, noteProps } from './note-fixtures.js'
import { toRichText } from '@tldraw/tlschema'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }
const near = (a, b) => Math.abs(a - b) < .15

export function checkNoteGallery(mode) {
  // Independent runtime readings, not expectations derived from the palette.
  const colors = ['252, 225, 156', '192, 202, 211', '223, 176, 249', '219, 145, 253', '138, 163, 255', '155, 196, 253', '254, 212, 154', '250, 164, 117', '111, 200, 150', '152, 208, 138', '247, 165, 161', '252, 130, 130', '255, 255, 255']
  const shapes = [...document.querySelectorAll('#canvas [data-shape-type="note"]')]
  if (mode === 'note-colors') shapes.forEach((shape, i) => {
    const paper = shape.querySelector('[data-note-body]').firstElementChild, paint = getComputedStyle(paper)
    check(paint.backgroundColor === `rgb(${colors[i]})` && paint.boxShadow !== 'none', `便签色板或阴影不符：${i}`)
  })
  if (mode === 'note-text') shapes.forEach((shape, i) => {
    check(getComputedStyle(shape.querySelector('[data-note-line]')).fontSize === `${[18, 22, 26, 32][Math.floor(i / 3)]}px`, '便签四档实测字号不符')
  })
  if (mode === 'note-whitespace') {
    check(near(shapes[0].querySelector('[data-note-body]').getBoundingClientRect().height, 507), '连续空白换行未保留实测507高度')
    check(shapes[0].querySelector('[data-note-line]').textContent === `A${' '.repeat(50)}`, '行尾悬挂空白被删除')
    check(shapes[1].textContent === 'A  B' && shapes[2].textContent === 'A\tB' && shapes[3].textContent === '   A   ', '连续空格、首尾空格或制表符原文丢失')
  }
  return { count: shapes.length, measuredColorsAndShadow: mode === 'note-colors', measuredFontSizes: mode === 'note-text', preservedWhitespace: mode === 'note-whitespace' }
}

// Mounted, isolated Store; no write capability is exposed on the preview hook.
export async function runNoteProbe() {
  const fixture = createNoteGallery('note-layout'), raw = createCanvasStore()
  raw.loadStoreSnapshot(fixture.snapshot)
  const reads = new Set(), listeners = new Set()
  const store = new Proxy(raw, { get(target, key) {
    if (key === 'get') return id => { reads.add(id); return target.get(id) }
    if (key === 'listen') return (...args) => {
      const dispose = target.listen(...args), token = {}
      listeners.add(token)
      return () => { listeners.delete(token); dispose() }
    }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;width:1440px;height:1000px'
  document.body.append(host)
  const before = JSON.stringify(raw.getStoreSnapshot()), view = mountCanvasRenderer(host, { store })
  const node = id => host.querySelector(`[data-shape-id="${id}"]`)
  const body = id => node(id).querySelector('[data-note-body]')
  try {
    await settle()
    check(JSON.stringify(raw.getStoreSnapshot()) === before, '便签挂载写入了画板')
    for (const shape of Object.values(fixture.snapshot.store).filter(r => r.type === 'note')) {
      const rect = body(shape.id).getBoundingClientRect(), bounds = getShapeBounds(shape)
      if (!shape.rotation) check(near(rect.width, bounds.w) && near(rect.height, bounds.h), '便签DOM和纯几何外框不一致')
    }
    const first = raw.get('shape:note-layout-0'), neighbor = node('shape:note-layout-1')
    const neighborMarkup = neighbor.innerHTML
    check(node('shape:note-layout-10').querySelector('[data-note-author]')?.textContent === 'Avery', '署名未取文档用户的名字第一段')
    check(!node('shape:note-layout-12').querySelector('[data-note-author]'), '空便签不应显示署名')
    const alignPositions = [0, 1, 2].map(i => node(`shape:note-layout-${i}`).querySelector('[data-note-line]').offsetLeft)
    check(alignPositions[0] === 16 && alignPositions[0] < alignPositions[1] && alignPositions[1] < alignPositions[2], '水平三档对齐未生效')
    const verticalPositions = [0, 3, 6].map(i => node(`shape:note-layout-${i}`).querySelector('[data-note-line]').offsetTop)
    check(verticalPositions[0] === 16 && verticalPositions[0] < verticalPositions[1] && verticalPositions[1] < verticalPositions[2], '垂直三档对齐未生效')
    const changes = new Set(), observer = new MutationObserver(records => records.forEach(record => {
      const shape = record.target.nodeType === Node.ELEMENT_NODE ? record.target.closest('[data-shape-id]') : record.target.parentElement.closest('[data-shape-id]')
      if (shape) changes.add(shape.dataset.shapeId)
    }))
    observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true })
    try {
      reads.clear()
      raw.put([{ ...first, props: noteProps({ font: 'sans', align: 'end', verticalAlign: 'end', color: 'blue', labelColor: 'red', richText: toRichText(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n')) }) }])
      await settle()
      check(reads.has(first.id) && [...reads].every(id => id === first.id), `单便签更新读取了其他记录：${[...reads]}`)
      check(changes.has(first.id) && [...changes].every(id => id === first.id), '单便签更新重画了其他形状')
      check(node('shape:note-layout-1') === neighbor && neighbor.innerHTML === neighborMarkup, '相邻便签被改动')
      check(near(body(first.id).getBoundingClientRect().height, 388.25), '十二行便签没有即时增高')
      // y=220 is below the original 200px note, before the next gallery row.
      check(view.hitTest({ x: 100, y: 220 }) === first.id, '增长的便签下半部无法点中')
      check(getComputedStyle(node(first.id).querySelector('[data-note-line]')).color === 'rgb(224, 49, 49)', '标签颜色没有更新')
      reads.clear(); changes.clear()
      const beforeCamera = getTextLayoutStats()
      for (const z of [.5, 2, 4]) { view.setCamera({ x: 8, y: 9, z }); await settle() }
      check(reads.size === 0 && changes.size === 0, '相机更新读取或重画了便签')
      check(JSON.stringify(getTextLayoutStats()) === JSON.stringify(beforeCamera), '相机更新重新测量了便签文字')
    } finally { observer.disconnect() }
    raw.put([{ ...raw.get('user:note-author'), name: 'Updated Family' }]); await settle()
    check(node('shape:note-layout-10').querySelector('[data-note-author]').textContent === 'Updated', '文档用户改名没有更新署名')
    view.setCamera({ x: 0, y: 0, z: 1 })
    raw.put([{ ...first, props: noteProps({ richText: toRichText('<script>😀é\n\n中\nA\u00a0B') }) }]); await settle()
    check(!node(first.id).querySelector('script') && node(first.id).textContent.includes('<script>'), '便签把文字解释成HTML')
    check(node(first.id).querySelectorAll('[data-note-line]').length === 4 && node(first.id).textContent.includes('A\u00a0B'), '空段落或不换行空格丢失')
    raw.put([{ ...first, props: noteProps({ font: 'sans', richText: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'AV', marks: [{ type: 'bold' }] }, { type: 'text', text: ' ffi', marks: [{ type: 'italic' }] },
    ] }] } }) }]); await settle()
    const richLine = node(first.id).querySelector('[data-note-line]'), spans = [...richLine.children]
    check(getComputedStyle(spans[0]).fontWeight === '700' && getComputedStyle(spans[1]).fontStyle === 'italic', '便签丢失粗体或斜体文字段')
    const richRange = document.createRange(); richRange.selectNodeContents(richLine)
    const expected = measureText('AV', { font: 'sans', size: 22, weight: 700 }).width + measureText(' ffi', { font: 'sans', size: 22, style: 'italic' }).width
    check(near(richRange.getBoundingClientRect().width, expected), '便签粗体／斜体自然宽度与共享测量不符')
    view.unmount(); view.unmount()
    check(listeners.size === 0 && host.children.length === 0, '便签卸载残留订阅或DOM')
    reads.clear(); raw.put([{ ...first, x: 5 }]); await settle()
    check(reads.size === 0, '卸载后便签仍在读取记录')
    return { measuredGrowthAndHitTest: true, nineAlignments: true, singleRecordAndDOMUpdate: true, cameraNoRecordReads: true, cameraDoesNotMeasure: true, richRunsNaturalWidth: true, attributionUpdates: true, plainTextAndEmptyLines: true, subscriptionsReleased: true }
  } finally { view.unmount(); host.remove() }
}

export async function runFrameTitleProbe() {
  const fixture = createNoteGallery('frame-titles'), store = createCanvasStore()
  store.loadStoreSnapshot(fixture.snapshot)
  const host = document.createElement('div'); document.body.append(host)
  const before = JSON.stringify(store.getStoreSnapshot()), view = mountCanvasRenderer(host, { store })
  try {
    await settle()
    for (const z of [.5, 1, 2, 4]) {
      view.setCamera({ x: 35, y: 40, z }); await settle()
      for (const [index, frame] of Object.values(fixture.snapshot.store).filter(r => r.type === 'frame').entries()) {
        const title = host.querySelector(`[data-shape-id="${frame.id}"] [data-frame-title]`), rect = title.getBoundingClientRect()
        check(getComputedStyle(title).overflow === 'hidden', '多行标题没有按旧版在外层裁切')
        check(near(rect.height, 28) && near(rect.x, (frame.x + 35) * z - 7) && near(rect.y, (frame.y + 40) * z - 28), '画框标题未保持固定屏幕位置或28高度')
        check(rect.width <= frame.props.w * z + 16.15, '标题超过画框允许的截断宽度')
        // 2026-11-25 旧版DOM实测总宽（含两侧6px）；独立于被测测字实现。
        const observedWidths = [72.3125, 84, undefined, 47.359375, 54.6875, 49.890625]
        if (observedWidths[index] !== undefined) check(near(rect.width, Math.min(observedWidths[index], frame.props.w * z + 16)), `标题自然字宽与旧版实测不符：${index} / ${rect.width}`)
        const label = title.querySelector('span'), style = getComputedStyle(label)
        check(style.fontSize === '12px' && style.color === 'rgb(0, 0, 0)' && style.textOverflow === 'ellipsis' && style.whiteSpace === 'pre', '标题字号、颜色、省略或换行改变')
        check(style.textSpacingTrim === 'space-all' && style.textAutospace === 'no-autospace', '画框标题未关闭标点挤压和自动加距')
        check(label.textContent === (frame.props.name || 'Frame'), '空标题后备文案或原文丢失')
      }
    }
    view.setCamera({ x: 35, y: 40, z: 1 }); await settle()
    const titles = [...host.querySelectorAll('[data-frame-title]')]
    const lastWidths = new Map(titles.map(title => [title, parseFloat(title.style.width)])), writes = []
    const observer = new MutationObserver(records => records.forEach(({ target }) => {
      if (!lastWidths.has(target)) return
      const width = parseFloat(target.style.width), previous = lastWidths.get(target)
      check(Math.abs(width - previous) >= .5, '缩放时标题宽度变化不足半像素仍写入布局属性')
      lastWidths.set(target, width); writes.push(target.closest('[data-shape-id]').dataset.shapeId)
    }))
    observer.observe(host, { subtree: true, attributes: true, attributeFilter: ['style'] })
    try {
      for (const z of [1.0001, 1.0002, 1.0003, 1.001, 1.002, 1.003, 1.01, 1.02]) { view.setCamera({ x: 35, y: 40, z }); await settle() }
      check(!writes.includes('shape:frame-titles-0'), '没有截断的标题缩放时写入了宽度')
      check(writes.includes('shape:frame-titles-6'), '探针没有覆盖实际发生宽度变化的截断标题')
    } finally { observer.disconnect() }
    check(JSON.stringify(store.getStoreSnapshot()) === before, '标题挂载或缩放写入了画板')
    const frame = store.get('shape:frame-titles-0')
    store.put([{ ...frame, props: { ...frame.props, name: '更新标题', w: 90 } }]); await settle()
    check(host.querySelector('[data-shape-id="shape:frame-titles-0"] [data-frame-title]').textContent === '更新标题', '标题记录更新没有画出')
    check(before !== JSON.stringify(store.getStoreSnapshot()), '探针没有完成记录更新')
    store.put([{ ...frame, props: { ...frame.props, name: '「。」』）。', w: 400 } }]); await settle()
    const root = host.querySelector('[data-shape-id="shape:frame-titles-0"] [data-frame-title-root]')
    const range = document.createRange(); range.selectNodeContents(root.querySelector('span'))
    check(near(root.getBoundingClientRect().width, range.getBoundingClientRect().width + 12), '画框标题的标点自然宽度与显示侧测量不符')
    return { fixedScreenTitleAtFourZooms: true, measuredPositionAndSize: true, truncationAndFallback: true, widthUpdateThreshold: true, recordUpdates: true, punctuationNaturalWidth: true }
  } finally { view.unmount(); host.remove() }
}
