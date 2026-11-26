import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { createEmbedGallery, inlinePage } from './embed-gallery.js'
import { EMBED_FRAME_ATTRIBUTES } from '../../renderer/embed-content.js'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }
async function until(predicate) {
  const end = Date.now() + 10000
  while (Date.now() < end) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('内嵌内容等待超时。')
}

// Automation only. Production renderer exposes no Store or HTML editing bridge.
export async function runEmbedProbe() {
  const fixture = createEmbedGallery(), raw = createCanvasStore(), reads = new Set(), listeners = new Set()
  raw.loadStoreSnapshot(fixture.snapshot)
  const store = new Proxy(raw, { get(target, key) {
    if (key === 'get') return id => { reads.add(id); return target.get(id) }
    if (key === 'listen') return (...args) => { const dispose = target.listen(...args), token = {}; listeners.add(token); return () => { listeners.delete(token); dispose() } }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const host = document.createElement('div'); host.style.position = 'fixed'; host.style.inset = '0'; document.body.append(host)
  const before = JSON.stringify(raw.getStoreSnapshot()), renderer = mountCanvasRenderer(host, { store, pageId: fixture.viewState.currentPageId })
  const iframe = id => host.querySelector(`[data-embed-content="${id}"]`)
  const instance = node => node?.contentDocument?.documentElement?.dataset.instance
  const webId = 'shape:embed-web', filmId = 'shape:embed-film'
  let pending, originalFetch
  try {
    await until(() => instance(iframe(webId)) && instance(iframe(filmId)) && instance(iframe('shape:embed-slide')))
    check(JSON.stringify(raw.getStoreSnapshot()) === before, '展示 HTML 不应写回记录')
    const web = iframe(webId), film = iframe(filmId), webInstance = instance(web), filmInstance = instance(film)
    for (const [key, value] of Object.entries(EMBED_FRAME_ATTRIBUTES)) check(web.getAttribute(key.toLowerCase()) === String(value), `iframe 属性改变：${key}`)
    check(!web.hasAttribute('allow') && film.getAttribute('allow') === 'autoplay', '影片 autoplay 权限与旧版不一致')
    check(web.contentWindow.parent.document === document, '本单按审定保留同源；不得把它报告成安全隔离')
    check(web.contentDocument.querySelector('h1')?.textContent === '网页', '中文 HTML 没有显示')
    check(iframe('shape:embed-slide').closest('[data-frame-clip]'), '幻灯片页未在画框内裁剪')
    const external = host.querySelector('[data-shape-id="shape:embed-external"]'), bookmark = host.querySelector('[data-shape-id="shape:embed-bookmark"]')
    check(!external.querySelector('iframe') && external.querySelector('[data-bookmark-url]')?.textContent === 'example.invalid', '未知外部嵌入应退回书签并保留网址')
    check(!bookmark.querySelector('iframe') && bookmark.textContent.includes('合成书签'), '书签没有复用资源元数据')
    await until(() => host.querySelector('[data-shape-id="shape:embed-error"]').textContent.includes('HTML 内容为空'))
    for (const status of ['queued', 'running', 'failed', 'interrupted', 'pending', 'working', 'waiting', 'saved']) check(host.querySelector(`[data-generation-status="${status}"]`), `生成状态缺失：${status}`)
    check(host.querySelector('[data-generation-status="failed"]').textContent.includes('合成错误'), '生成失败详情未展示')
    reads.clear()
    renderer.setCamera({ x: -20000, y: -20000, z: .2 }); await settle()
    renderer.setCamera({ x: 12, y: 23, z: 1.5 }); await settle()
    check(reads.size === 0 && iframe(webId) === web && iframe(filmId) === film && instance(web) === webInstance && instance(film) === filmInstance, '镜头或离屏重载了内嵌页')
    reads.clear()
    const first = raw.get(webId)
    raw.put([{ ...first, x: 90, y: 110, rotation: .3, opacity: .6, props: { ...first.props, w: 600, h: 340 } }]); await settle()
    check([...reads].every(id => id === webId) && reads.has(webId), `更新一条记录重读其他记录：${[...reads]}`)
    check(iframe(webId) === web && instance(web) === webInstance && instance(film) === filmInstance, '变更几何重载了内容')
    const element = web.parentElement, box = web.getBoundingClientRect()
    check(web.width === '600' && web.height === '340' && element.style.opacity === '0.6' && element.style.transform.includes('rotate(0.3rad)'), '几何与透明度没有应用')
    const expectedWidth = (600 * Math.cos(.3) + 340 * Math.sin(.3)) * 1.5
    check(Math.abs(box.width - expectedWidth) < .1, '屏幕外框没有按旋转及视角缩放')
    const center = { x: (90 + 300 * Math.cos(.3) - 170 * Math.sin(.3) + 12) * 1.5, y: (110 + 300 * Math.sin(.3) + 170 * Math.cos(.3) + 23) * 1.5 }
    check(renderer.hitTest(center) === webId, '点中 HTML 未返回形状')
    raw.put([{ ...raw.get(webId), props: { ...first.props, url: inlinePage('内容已替换') } }])
    await until(() => iframe(webId)?.contentDocument?.querySelector('h1')?.textContent === '内容已替换')
    check(instance(iframe(filmId)) === filmInstance, '内容更新重载了相邻影片')
    // Same source, new content hash must re-read. A stale request must not win.
    originalFetch = window.fetch
    let requests = 0
    window.fetch = async (url, options) => {
      if (url === '/c/synthetic/assets/pending.html') { requests++; return new Promise(resolve => { pending = { resolve, signal: options.signal } }) }
      return originalFetch(url, options)
    }
    const local = { ...raw.get(webId), props: { ...first.props, url: '/c/synthetic/assets/pending.html' }, meta: { cowartHtmlDraft: true, cowartHtmlDraftContentHash: 'v1' } }
    raw.put([local]); await until(() => pending)
    check(host.querySelector(`[data-shape-id="${webId}"]`).textContent.includes('内容加载中'), '异步内容未显示加载态')
    const stale = pending; pending = null
    raw.put([{ ...local, meta: { ...local.meta, cowartHtmlDraftContentHash: 'v2' } }]); await until(() => pending)
    check(stale.signal.aborted && requests === 2, '内容哈希变化没有取消旧请求并重读')
    pending.resolve(new Response('<h1>新修订</h1>', { headers: { 'content-type': 'text/html' } }))
    await until(() => iframe(webId)?.contentDocument?.querySelector('h1')?.textContent === '新修订')
    stale.resolve(new Response('<h1>过期修订</h1>', { headers: { 'content-type': 'text/html' } })); await settle()
    check(iframe(webId).contentDocument.querySelector('h1').textContent === '新修订', '旧请求覆盖了新内容')
    pending = null
    raw.put([{ ...local, meta: { ...local.meta, cowartHtmlDraftContentHash: 'v3' } }]); await until(() => pending)
    pending.resolve(new Response('合成加载失败', { status: 503 }))
    await until(() => host.querySelector(`[data-shape-id="${webId}"]`).textContent.includes('内容加载失败：503'))
    pending = null
    raw.put([{ ...local, meta: { ...local.meta, cowartHtmlDraftContentHash: 'v4' } }]); await until(() => pending)
    renderer.unmount(); await settle()
    check(pending.signal.aborted && listeners.size === 0 && host.children.length === 0, '卸载没有取消加载或释放订阅及 DOM')
    reads.clear(); raw.put([{ ...first, x: 200 }]); await settle(); check(reads.size === 0, '卸载后仍读取记录')
    return { htmlKinds: 3, inheritedSandbox: true, knownSameOriginRisk: true, placeholders: true, generationStates: 8, cameraAndOffscreenKeepInstance: true, singleRecordUpdate: true, geometryAndHit: true, contentRevision: true, staleRequestIgnored: true, abortAndUnmount: true }
  } finally { if (originalFetch) window.fetch = originalFetch; renderer.unmount(); host.remove() }
}
