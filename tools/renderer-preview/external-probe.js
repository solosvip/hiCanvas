import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { createExternalGallery } from './external-gallery.js'
import { externalSamples } from './external-samples.js'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }
async function until(predicate) {
  const end = Date.now() + 15000
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('本机假嵌入页面等待超时。')
}

// Exercise the public mount with valid records; the harness supplies fake HTTP
// pages by intercepting the sampled URLs before requests can leave this host.
export async function runExternalProbe() {
  const fixture = createExternalGallery(), store = createCanvasStore()
  store.loadStoreSnapshot(fixture.snapshot)
  const host = document.createElement('div'); host.style.position = 'fixed'; host.style.inset = '0'; document.body.append(host)
  const before = JSON.stringify(store.getStoreSnapshot()), renderer = mountCanvasRenderer(host, { store })
  const iframe = id => host.querySelector(`[data-external-service="${id}"]`)
  // Navigation can expose a document before its root element exists.
  const instance = node => node?.contentDocument?.documentElement?.dataset.instance
  try {
    const bases = externalSamples.filter(sample => sample.kind === 'base' && sample.src)
    await until(() => bases.every(sample => instance(iframe(sample.id))))
    check(host.querySelectorAll('iframe').length === 17, '17 项普通嵌入没有全部显示')
    const identities = new Map(bases.map(sample => [sample.id, { node: iframe(sample.id), instance: instance(iframe(sample.id)) }]))
    for (const sample of bases) {
      const node = iframe(sample.id), attrs = sample.attributes
      let expected = sample.src
      if (sample.id === 'G06') {
        const encoded = new URL('https://www.figma.com/embed')
        encoded.searchParams.set('embed_host', 'share'); encoded.searchParams.set('url', sample.input)
        expected = encoded.href
      }
      check(node.getAttribute('src') === expected, `实际src与获批规范地址不同：${sample.id}`)
      check(node.getAttribute('sandbox') === attrs.sandbox && node.getAttribute('referrerpolicy') === attrs.referrerpolicy && node.getAttribute('allow') === attrs.allow && node.hasAttribute('allowfullscreen') === (attrs.allowfullscreen !== null), `iframe 权限与旧版不同：${sample.id}`)
      check(node.width === String(sample.size[0]) && node.height === String(sample.size[1]), `嵌入尺寸不同：${sample.id}`)
    }
    const gist = host.querySelector('[data-shape-id="shape:external-G16"]')
    check(gist.querySelector('[data-bookmark-url]')?.textContent === 'gist.github.com' && !gist.querySelector('iframe'), 'Gist 应退回书签，包装留待 #78')
    const input = iframe('G13').contentDocument.querySelector('input'); input.value = '离屏后保留此状态'
    renderer.setCamera({ x: -20000, y: -20000, z: .05 }); await settle()
    renderer.setCamera({ x: 10, y: 15, z: 1.2 }); await settle()
    for (const [id, before] of identities) check(iframe(id) === before.node && instance(iframe(id)) === before.instance, `平移/缩放/离屏重新加载了 ${id}`)
    check(iframe('G13').contentDocument.querySelector('input').value === '离屏后保留此状态', '离屏丢失子页面状态')
    check(JSON.stringify(store.getStoreSnapshot()) === before, '挂载或相机变化写回了嵌入记录')
    const record = store.get('shape:external-G06'), node = iframe('G06'), identity = instance(node)
    store.put([{ ...record, x: 100, y: 110, rotation: .3, opacity: .6, props: { ...record.props, w: 500, h: 300 } }]); await settle()
    check(iframe('G06') === node && instance(node) === identity && node.width === '500' && node.height === '300', '修改几何重新加载了 iframe')
    check(node.parentElement.style.opacity === '0.6' && node.parentElement.style.transform.includes('rotate(0.3rad)'), '外部嵌入旋转或透明度未应用')
    const youtube = store.get('shape:external-G13'), changed = externalSamples.find(sample => sample.id === 'G13' && sample.input.includes('synthetic=83'))
    store.put([{ ...youtube, props: { ...youtube.props, url: changed.input } }])
    await until(() => instance(iframe('G13')) && instance(iframe('G13')) !== identities.get('G13').instance)
    check(instance(iframe('G06')) === identity, '更新一项URL重载了相邻页面')
    store.put([{ ...youtube, props: { ...youtube.props, url: 'https://unknown.example.test/retained' } }]); await settle()
    check(!iframe('G13') && host.querySelector('[data-bookmark="shape:external-G13"] [data-bookmark-url]').textContent === 'unknown.example.test', '未知URL没有保留为书签')
    renderer.unmount(); check(host.children.length === 0, '卸载未释放iframe')
    return { providers: 17, gistFallbackIssue: 78, sampledAttributes: true, geometry: true, offscreenAndCameraKeepInstance: true, childStatePreserved: true, noDocumentWrites: true, urlChangeReloadsOnlyTarget: true, unknownUrlBookmark: true, unmount: true }
  } finally { renderer.unmount(); host.remove() }
}
