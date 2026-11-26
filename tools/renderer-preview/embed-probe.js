import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer, loadGeneratedFrame } from '../../renderer/index.js'
import { createEmbedGallery, inlinePage } from './embed-gallery.js'
import { EMBED_FRAME_ATTRIBUTES } from '../../renderer/embed-content.js'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }
async function until(predicate) {
  const end = Date.now() + 10000
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)) }
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
  const pendingObservations=new Map(),loadCounts=new WeakMap();let requestId=0
  const receive=event=>{
    const task=pendingObservations.get(event.data?.request)
    if(task&&event.source===task.node.contentWindow&&event.origin===task.origin&&event.data?.type==='synthetic-embed-observation')task.finish(event.data)
  }
  addEventListener('message',receive)
  const observeScript=`<script>addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='synthetic-embed-observe')parent.postMessage({type:'synthetic-embed-observation',request:event.data.request,instance:document.documentElement.dataset.instance||(document.documentElement.dataset.instance=Math.random().toString(36)),title:document.querySelector('h1')?.textContent},event.origin)});<\/script>`
  const before = JSON.stringify(raw.getStoreSnapshot()), renderer = mountCanvasRenderer(host, { store, pageId: fixture.viewState.currentPageId, async loadGeneratedFrame(html,options){
    const frame=await loadGeneratedFrame(html+observeScript,options)
    return {...frame,bind(node,options){loadCounts.set(node,(loadCounts.get(node)||0)+1);return frame.bind(node,options)}}
  } })
  const iframe = id => host.querySelector(`[data-embed-content="${id}"]`)
  async function observation(node){
    if(!node?.src)return null
    const request=++requestId,origin=new URL(node.src).origin
    return new Promise(resolve=>{
      let timer
      const finish=value=>{clearTimeout(timer);pendingObservations.delete(request);resolve(value)}
      pendingObservations.set(request,{node,origin,finish})
      timer=setTimeout(()=>finish(null),1000)
      node.contentWindow.postMessage({type:'synthetic-embed-observe',request},origin)
    })
  }
  const instance = async node => (await observation(node))?.instance
  const webId = 'shape:embed-web', filmId = 'shape:embed-film'
  let pending, originalFetch
  try {
    await until(async() => (await Promise.all([webId,filmId,'shape:embed-slide'].map(id=>instance(iframe(id))))).every(Boolean))
    check(JSON.stringify(raw.getStoreSnapshot()) === before, '展示 HTML 不应写回记录')
    const web = iframe(webId), film = iframe(filmId), webInstance = await instance(web), filmInstance = await instance(film),webLoads=loadCounts.get(web),filmLoads=loadCounts.get(film)
    for (const [key, value] of Object.entries(EMBED_FRAME_ATTRIBUTES)) if(key!=='sandbox')check(web.getAttribute(key.toLowerCase()) === String(value), `iframe 属性改变：${key}`)
    check(['allow-forms','allow-popups','allow-scripts','allow-same-origin'].every(value=>web.sandbox.contains(value))&&web.sandbox.length===4,'已校验实例的权限改变')
    check(!web.hasAttribute('allow') && film.getAttribute('allow') === 'autoplay', '影片 autoplay 权限与旧版不一致')
    check(!web.contentDocument && new URL(web.src).origin!==location.origin, '生成页不得取得父来源')
    check((await observation(web))?.title === '网页', '中文 HTML 没有显示')
    check(iframe('shape:embed-slide').closest('[data-frame-clip]'), '幻灯片页未在画框内裁剪')
    const external = host.querySelector('[data-shape-id="shape:embed-external"]'), bookmark = host.querySelector('[data-shape-id="shape:embed-bookmark"]')
    check(!external.querySelector('iframe') && external.querySelector('[data-bookmark-url]')?.textContent === 'example.invalid', '未知外部嵌入应退回书签并保留网址')
    check(!bookmark.querySelector('iframe') && bookmark.textContent.includes('合成书签'), '书签没有复用资源元数据')
    await until(() => host.querySelector('[data-shape-id="shape:embed-error"]').textContent.includes('HTML 内容为空'))
    for (const status of ['queued', 'running', 'failed', 'interrupted', 'pending', 'working', 'waiting', 'saved']) {
      const overlay = host.querySelector(`[data-generation-status="${status}"]`)
      check(overlay, `生成状态缺失：${status}`)
      const frame = overlay.closest('[data-shape-id]'), body = frame.querySelector(':scope > svg')
      const overlayBox = overlay.getBoundingClientRect(), bodyBox = body.getBoundingClientRect()
      check(bodyBox.width > 0 && bodyBox.height > 0 && overlayBox.width >= bodyBox.width && overlayBox.height >= bodyBox.height, `生成状态没有铺满画框：${status}`)
      check(Math.abs(overlayBox.left - bodyBox.left) < .01 && Math.abs(overlayBox.top - bodyBox.top) < .01, `生成状态偏离画框：${status}`)
    }
    check(host.querySelector('[data-generation-status="failed"]').textContent.includes('合成错误'), '生成失败详情未展示')
    reads.clear()
    renderer.setCamera({ x: -20000, y: -20000, z: .2 }); await settle()
    renderer.setCamera({ x: 12, y: 23, z: 1.5 }); await settle()
    check(reads.size === 0 && iframe(webId) === web && iframe(filmId) === film && await instance(web) === webInstance && await instance(film) === filmInstance && loadCounts.get(web)===webLoads && loadCounts.get(film)===filmLoads, '镜头或离屏重载了内嵌页')
    reads.clear()
    const first = raw.get(webId)
    raw.put([{ ...first, x: 90, y: 110, rotation: .3, opacity: .6, props: { ...first.props, w: 600, h: 340 } }]); await settle()
    check([...reads].every(id => id === webId) && reads.has(webId), `更新一条记录重读其他记录：${[...reads]}`)
    check(iframe(webId) === web && await instance(web) === webInstance && await instance(film) === filmInstance && loadCounts.get(web)===webLoads && loadCounts.get(film)===filmLoads, '变更几何重载了内容')
    const element = web.parentElement, box = web.getBoundingClientRect()
    check(web.width === '600' && web.height === '340' && element.style.opacity === '0.6' && element.style.transform.includes('rotate(0.3rad)'), '几何与透明度没有应用')
    const expectedWidth = (600 * Math.cos(.3) + 340 * Math.sin(.3)) * 1.5
    check(Math.abs(box.width - expectedWidth) < .1, '屏幕外框没有按旋转及视角缩放')
    const center = { x: (90 + 300 * Math.cos(.3) - 170 * Math.sin(.3) + 12) * 1.5, y: (110 + 300 * Math.sin(.3) + 170 * Math.cos(.3) + 23) * 1.5 }
    check(renderer.hitTest(center) === webId, '点中 HTML 未返回形状')
    raw.put([{ ...raw.get(webId), props: { ...first.props, url: inlinePage('内容已替换') } }])
    await until(async() => (await observation(iframe(webId)))?.title === '内容已替换')
    check(await instance(iframe(filmId)) === filmInstance && loadCounts.get(film)===filmLoads, '内容更新重载了相邻影片')
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
    await until(async() => (await observation(iframe(webId)))?.title === '新修订')
    stale.resolve(new Response('<h1>过期修订</h1>', { headers: { 'content-type': 'text/html' } })); await settle()
    check((await observation(iframe(webId)))?.title === '新修订', '旧请求覆盖了新内容')
    pending = null
    raw.put([{ ...local, meta: { ...local.meta, cowartHtmlDraftContentHash: 'v3' } }]); await until(() => pending)
    pending.resolve(new Response('合成加载失败', { status: 503 }))
    await until(() => host.querySelector(`[data-shape-id="${webId}"]`).textContent.includes('内容加载失败：503'))
    pending = null
    raw.put([{ ...local, meta: { ...local.meta, cowartHtmlDraftContentHash: 'v4' } }]); await until(() => pending)
    renderer.unmount(); await settle()
    check(pending.signal.aborted && listeners.size === 0 && host.children.length === 0, '卸载没有取消加载或释放订阅及 DOM')
    reads.clear(); raw.put([{ ...first, x: 200 }]); await settle(); check(reads.size === 0, '卸载后仍读取记录')
    return { htmlKinds: 3, isolatedContentHost: true, parentDocumentBlocked: true, placeholders: true, generationStates: 8, generationStateBounds: 8, cameraAndOffscreenKeepInstance: true, singleRecordUpdate: true, geometryAndHit: true, contentRevision: true, staleRequestIgnored: true, abortAndUnmount: true }
  } finally { for(const task of pendingObservations.values())task.finish(null); removeEventListener('message',receive); if (originalFetch) window.fetch = originalFetch; renderer.unmount(); host.remove() }
}
