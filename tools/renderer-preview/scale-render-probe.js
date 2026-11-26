import { mountCanvasRenderer } from '../../renderer/index.js'
import { getShapeBounds, createSpatialIndex } from '../../renderer/geometry.js'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

// A readonly Store adapter tests the renderer's public host contract, including
// a synthetic type registered only by the smoke server's geometry fixture.
export async function runScaleRenderProbe() {
  const page = { id: 'page:scaling', typeName: 'page' }
  const shape = (id, type, x) => ({ id, typeName: 'shape', type, parentId: page.id, index: 'a1', x, y: 0, rotation: 0, opacity: 1, isLocked: false, meta: {}, props: { w: 100, h: 80 } })
  const video = shape('shape:video-probe', 'video', 0)
  const synthetic = shape('shape:geometry-only-probe', 'synthetic_geometry_only', 200)
  const geo = { ...shape('shape:geo-probe', 'geo', 400), props: { w: 100, h: 80, growY: 0, geo: 'rectangle', color: 'black', size: 'm', fill: 'none', dash: 'solid', scale: 1 } }
  const records = [page, video, synthetic, geo], byId = new Map(records.map(r => [r.id, r]))
  const store = {
    get: id => byId.get(id), allRecords: () => records, getStoreSnapshot: () => ({ store: Object.fromEntries(byId) }), listen: () => () => {},
    // The renderer mounts its text-editing view on every mount (#132), and that
    // view observes changes; a readonly Store has none to report.
    addHistoryInterceptor: () => () => {},
    query: { ids: (type, expression) => ({ get: () => new Set(records.filter(r => r.typeName === type && Object.entries(expression()).every(([key, value]) => r[key] === value.eq)).map(r => r.id)) }) },
    createComputedCache: (_name, derive) => ({ get: id => byId.has(id) ? derive(byId.get(id)) : undefined }),
  }
  const host = document.createElement('div'); document.body.append(host)
  let view
  try {
    view = mountCanvasRenderer(host, { store, pageId: page.id })
    await settle()
    const index = createSpatialIndex(records, page.id)
    for (const record of [video, synthetic]) {
      const node = host.querySelector(`[data-shape-id="${record.id}"]`)
      check(getShapeBounds(record)?.w === 100, `${record.type} 没有登记保存几何，守卫前置失败`)
      check(node, `${record.type} 没有挂载，守卫前置失败`)
      check(node.childElementCount === 0, `${record.type} 没有绘制器却被画出了图形`)
      check(index.query({ x: record.x + 20, y: 20, w: 1, h: 1 }).includes(record.id), `${record.type} 无法按范围查询`)
      check(view.hitTest({ x: record.x + 20, y: 20 }) === record.id, `${record.type} 空白外框无法点选`)
    }
    check(host.querySelector('[data-shape-id="shape:geo-probe"] [data-geo-outline]'), 'geo 绘制分派丢失')
    return { videoBodyEmpty: true, geometryOnlyBodyEmpty: true, storedGeometryQueryable: true, blankBoundsSelectable: true, geoStillDraws: true }
  } finally { try { view?.unmount() } finally { host.remove() } }
}
