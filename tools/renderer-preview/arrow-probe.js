import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { getConnectionGeometry, shapeToPagePoint, canvasToScreen } from '../../renderer/geometry.js'
import { createConnectionGallery } from './arrow-gallery.js'

const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }

async function drawingCoordinatesProbe() {
  let checked = 0
  for (const mode of ['arrows', 'lines', 'bindings']) {
    const fixture = createConnectionGallery(mode), store = createCanvasStore()
    // Horizontal unlabelled lines and bound arrows expose inline SVG baseline
    // shifts that a path-string or pure-geometry assertion cannot detect.
    if (mode === 'lines') for (const shape of Object.values(fixture.snapshot.store)) if (shape.type === 'line') for (const point of Object.values(shape.props.points)) point.y = 0
    if (mode === 'bindings') fixture.snapshot.store['shape:bound-0'].props.richText = { type: 'doc', content: [{ type: 'paragraph' }] }
    store.loadStoreSnapshot(fixture.snapshot)
    const host = document.createElement('div'); document.body.append(host)
    let renderer
    try {
      const camera = { x: 35, y: 27, z: .7 }
      renderer = mountCanvasRenderer(host, { store, camera, pageId: fixture.viewState.currentPageId }); await settled()
      const origin = host.getBoundingClientRect()
      for (const body of host.querySelectorAll('[data-connection-body]')) {
        const id = body.closest('[data-shape-id]').dataset.shapeId, record = store.get(id), geometry = getConnectionGeometry(record, fixture.snapshot)
        for (const point of [geometry.path.at(0), geometry.path.at(1)]) {
          const actual = new DOMPoint(point.x, point.y).matrixTransform(body.getScreenCTM())
          const expected = canvasToScreen(shapeToPagePoint(fixture.snapshot, id, point), camera)
          check(Math.hypot(actual.x - origin.x - expected.x, actual.y - origin.y - expected.y) < .05, `绘制坐标偏离几何端点：${id}`)
          checked++
        }
      }
    } finally { renderer?.unmount(); host.remove() }
  }
  return checked
}

export async function runConnectionProbe() {
  const fixture = createConnectionGallery('bindings'), store = createCanvasStore()
  store.loadStoreSnapshot(fixture.snapshot)
  let subscriptions = 0
  const intercept = store.addHistoryInterceptor.bind(store)
  store.addHistoryInterceptor = fn => { subscriptions++; const stop = intercept(fn); return () => { subscriptions--; stop() } }
  const host = document.createElement('div'); document.body.append(host)
  const renderers = [], hosts = [host], observers = [], changes = [0, 0, 0, 0]
  const mount = (element, options) => { const renderer = mountCanvasRenderer(element, options); renderers.push(renderer); return renderer }
  const body = i => host.querySelector(`[data-shape-id="shape:bound-${i}"] [data-connection-body]`)
  try {
    const renderer = mount(host, { store, pageId: fixture.viewState.currentPageId }); await settled()
    check(subscriptions === 1, '同一画板的连接线未共享订阅')
    const before = changes.map((_, i) => body(i).getAttribute('d'))
    for (let i = 0; i < 4; i++) {
      const observer = new MutationObserver(records => { changes[i] += records.filter(r => r.attributeName === 'd').length })
      observer.observe(body(i), { attributes: true }); observers.push(observer)
    }
    const target = store.get('shape:target-0')
    store.put([{ ...target, x: target.x + 80 }]); await settled()
    check(changes[0] > 0 && changes.slice(1).every(n => n === 0), `移动目标重画了无关箭头：${changes}`)
    check(body(0).getAttribute('d') !== before[0], '绑定箭头没有跟随目标')
    const arrow = store.get('shape:bound-0'), g = getConnectionGeometry(arrow, store.getStoreSnapshot())
    const labelPoint = { x: arrow.x + g.label.center.x, y: arrow.y + g.label.center.y + 11 }
    check(renderer.hitTest(labelPoint) === arrow.id, '标签外缘未命中绑定箭头')
    check(renderer.hitTest({ x: arrow.x + 20, y: arrow.y }) === arrow.id, '线身未命中')
    check(renderer.hitTest({ x: arrow.x + 20, y: arrow.y + 30 }) === null, '外框空白被当成线身')
    const frame = store.get('shape:binding-frame'); store.put([{ ...frame, x: frame.x + 40 }]); await settled()
    check(changes[1] === 0 && changes[2] === 0 && changes[3] > 0, '框祖先变化没有局部重画内层目标的箭头')
    const oldBinding = store.get('binding:connection-0')
    store.put([{ ...oldBinding, toId: 'shape:target-1' }]); await settled()
    const afterRetarget = body(0).getAttribute('d')
    store.put([{ ...target, x: target.x + 150 }]); await settled()
    check(body(0).getAttribute('d') === afterRetarget, '换目标后仍依赖旧目标')
    store.remove(['binding:connection-0']); await settled()
    check(body(0).getAttribute('d').includes('510'), '解绑没有恢复记录端点')
    const shape = store.get(arrow.id)
    for (const fill of ['none', 'semi', 'solid', 'fill', 'pattern', 'lined-fill']) {
      store.put([{ ...shape, props: { ...shape.props, fill, arrowheadStart: 'triangle', arrowheadEnd: 'dot', color: 'red', labelColor: 'blue' } }]); await settled()
      const element = host.querySelector(`[data-shape-id="${arrow.id}"]`)
      check(element.querySelectorAll('[data-connection-head]').length === 2, '两端闭合端帽缺失')
      check(element.querySelector('[data-connection-label]').getAttribute('fill') === '#4465e9', '标签独立颜色无效')
      if (fill === 'pattern') check(element.querySelector('pattern'), '端帽图案未定义')
      else check(element.querySelector('[data-connection-head]').getAttribute('fill') === ({ none: 'none', semi: '#fcfffe', solid: '#f4dadb', fill: '#e03131', 'lined-fill': '#e75f5f' }[fill]), `端帽填充失效：${fill}`)
    }
    store.put([{ ...store.get(frame.id), type: 'group', props: {} }, { ...oldBinding, toId: frame.id }]); await settled()
    changes.fill(0)
    const child = store.get('shape:target-3'); store.put([{ ...child, x: child.x + 90 }]); await settled()
    check(changes[0] > 0 && changes[3] > 0 && changes[1] === 0 && changes[2] === 0, `组外框变化未局部更新：${changes}`)
    const narrow = document.createElement('div'); narrow.style.width = '320px'; document.body.append(narrow); hosts.push(narrow)
    const second = mount(narrow, { store, camera: { x: -100, y: -100, z: .5 }, pageId: fixture.viewState.currentPageId }); await settled()
    check(narrow.querySelectorAll('[data-connection]').length === 4, '小窗口漏画箭头')
    check(subscriptions === 1, '多处挂载产生了重复订阅')
    second.unmount(); narrow.remove(); renderer.unmount(); await settled()
    check(!host.querySelector('[data-shape-id]') && subscriptions === 0, '卸载残留图形或订阅')
    store.put([{ ...target, x: 900 }]); await settled()
    const remount = mount(host, { store, pageId: fixture.viewState.currentPageId }); await settled()
    check(host.querySelectorAll('[data-connection]').length === 4 && subscriptions === 1, '重新挂载丢失或重复订阅')
    remount.unmount(); check(subscriptions === 0, '重新挂载后未释放订阅')
    return { relatedMutationCounts: changes, targetFollow: true, labelAndBodyHit: true, retarget: true, unbind: true, fills: 6, groupBounds: true, narrowAndRemount: true, drawingEndpointChecks: await drawingCoordinatesProbe() }
  } finally { observers.forEach(o => o.disconnect()); renderers.forEach(r => r.unmount()); hosts.forEach(h => h.remove()) }
}
