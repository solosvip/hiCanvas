import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { createFrameTitleFixture } from './frame-title-fixture.js'

let workload
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

// Same 5000 records and mounted frame bodies in both cases. Hiding titles
// removes their layout/paint only; their 50 subscriptions remain in the baseline.
export async function mountTitleWorkload() {
  const fixture = await (await fetch('/__renderer_fixture?count=5000')).json()
  const store = createCanvasStore(), { snapshot } = createFrameTitleFixture(fixture)
  const reads = new Set()
  const tracked = new Proxy(store, { get(target, key) {
    if (key === 'get') return id => { reads.add(id); return target.get(id) }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  store.loadStoreSnapshot(snapshot)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden'
  const preview = document.querySelector('#canvas'), previousDisplay = preview.style.display
  preview.style.display = 'none'; document.body.append(host)
  const view = mountCanvasRenderer(host, { store: tracked, camera: { x: 20, y: 60, z: .25 } })
  await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()))
  const titles = [...host.querySelectorAll('[data-frame-title]')]
  if (titles.length !== 50 || host.querySelectorAll('[data-shape-id]').length !== 5000) throw new Error('标题性能合成规模不符')
  await settle(); reads.clear()
  workload = { host, view, titles, store, reads, snapshot: JSON.stringify(store.getStoreSnapshot()), preview, previousDisplay }
  return { shapes: 5000, titles: titles.length, ordinaryShapes: 4950 }
}

export async function prepareTitleFrames(hidden) {
  const { titles, view } = workload
  titles.forEach(title => { title.style.display = hidden ? 'none' : '' })
  view.setCamera({ x: 20, y: 60, z: .25 }); await settle()
}

export async function runTitleFrames({ hidden = false, frames = 120, prepared = false } = {}) {
  const { view, reads } = workload
  if (!prepared) await prepareTitleFrames(hidden)
  reads.clear()
  let titleWidthWrites = 0
  const changes = new Set(), observer = new MutationObserver(records => records.forEach(record => {
    const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement
    if (element.matches('[data-frame-title]') && record.attributeName === 'style') titleWidthWrites++
    if (!element.closest('[data-frame-title-root]') && !element.matches('[data-renderer-world], [data-canvas-overlays]')) changes.add(element.closest('[data-shape-id]')?.dataset.shapeId || element.tagName)
  }))
  observer.observe(workload.host, { attributes: true, childList: true, characterData: true, subtree: true })
  const times = []
  try {
    await new Promise(resolve => {
      let step = 0, previous
      const tick = time => {
        if (previous !== undefined) times.push(time - previous)
        previous = time
        view.setCamera({ x: 20 + Math.sin(step / 12) * 5, y: 60, z: .25 * Math.exp(Math.sin(step / 20) * .15) })
        if (++step <= frames) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    await settle()
    if (reads.size || changes.size) throw new Error(`标题缩放触及普通记录/DOM：${[...reads]} / ${[...changes]}`)
    const ordered = [...times].sort((a, b) => a - b)
    return { hidden, frames: times.length, fps: 1000 * times.length / times.reduce((a, b) => a + b, 0), p95FrameMs: ordered[Math.floor(ordered.length * .95)], shapeReads: reads.size, ordinaryDOMChanges: changes.size, titleWidthWrites, titleWidthWritesPerFrame: titleWidthWrites / times.length }
  } finally { observer.disconnect() }
}

export function unmountTitleWorkload() {
  if (!workload) return
  const { view, host, store, snapshot, preview, previousDisplay } = workload
  view.unmount(); host.remove(); preview.style.display = previousDisplay; workload = undefined
  if (JSON.stringify(store.getStoreSnapshot()) !== snapshot) throw new Error('标题性能探针改写了画板')
}
