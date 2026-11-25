import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { getIndexAbove } from '@tldraw/utils'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }

// Imported only by the automated browser harness; the preview observation hook
// never exposes this probe, its Store, or any write capability.
export async function runLifecycleProbe() {
  const hook = window.__HICANVAS_RENDERER_PREVIEW__, originalCamera = hook.getState().camera
  check(JSON.stringify(hook.getCamera()) === JSON.stringify(originalCamera), '只读视角接口与观察状态不一致')
  const detached = hook.getCamera(); detached.x = 999
  check(hook.getCamera().x === originalCamera.x, '只读视角接口保留了可变引用')
  const reset = { x: -3, y: 5, z: .25 }
  hook.resetCamera(reset); await settle()
  check(JSON.stringify(hook.getState().camera) === JSON.stringify(reset), '测量重置视角未反映到只读观察接口')
  let invalidRejected = false
  try { hook.resetCamera({ x: 0, y: 0, z: 0 }) } catch { invalidRejected = true }
  check(invalidRejected, '测量重置允许了非法视角')
  hook.resetCamera(originalCamera); await settle()
  const fixture = await (await fetch('/__renderer_fixture?count=500')).json()
  const raw = createCanvasStore()
  raw.loadStoreSnapshot(fixture.snapshot)
  const reads = new Map(), listeners = new Set()
  const store = new Proxy(raw, { get(target, key) {
    if (key === 'get') return id => { reads.set(id, (reads.get(id) || 0) + 1); return target.get(id) }
    if (key === 'listen') return (...args) => {
      const dispose = target.listen(...args), token = {}
      listeners.add(token)
      return () => { listeners.delete(token); dispose() }
    }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const host = document.createElement('div')
  document.body.append(host)
  const before = JSON.stringify(raw.getStoreSnapshot()), view = mountCanvasRenderer(host, { store })
  try {
    await settle()
    check(JSON.stringify(raw.getStoreSnapshot()) === before, '挂载不应写入 Store')
    const first = raw.get('shape:perf-0'), neighbor = host.querySelector('[data-shape-id="shape:perf-1"]')
    reads.clear()
    raw.put([{ ...first, x: first.x + 10 }])
    await settle()
    check([...reads.keys()].every(id => id === first.id) && reads.has(first.id), `单条更新误读了其他形状：${[...reads.keys()]}`)
    check(host.querySelector(`[data-shape-id="${first.id}"]`).style.transform.includes('10px'), '变更未画出来')
    check(host.querySelector('[data-shape-id="shape:perf-1"]') === neighbor, '无关形状 DOM 被替换')
    reads.clear()
    const camera = { x: 8, y: 9, z: 2 }
    view.setCamera(camera); camera.x = 999
    await settle()
    check(reads.size === 0, '平移缩放不应重新读取形状')
    check(view.getCamera().x === 8, '相机不能保留外部可变引用')
    check(view.hitTest({ x: 56, y: 58 }) === first.id, '挂载接口的查询未应用相机')
    const topIndex = getIndexAbove(raw.get('shape:perf-499').index)
    const frame = { ...first, id: 'shape:probe-frame', type: 'frame', index: topIndex, props: { w: 100, h: 80, name: '合成框', color: 'blue' } }
    const child = { ...first, id: 'shape:probe-child', parentId: frame.id, x: 80, y: 10, index: 'a1' }
    raw.put([frame, child])
    await settle()
    const clip = host.querySelector('[data-frame-clip="shape:probe-frame"]')
    check(clip?.style.overflow === 'hidden' && clip.contains(host.querySelector('[data-shape-id="shape:probe-child"]')), '框内形状没有嵌套裁剪')
    raw.put([{ ...child, parentId: first.parentId, index: getIndexAbove(topIndex) }])
    await settle()
    check(!clip.contains(host.querySelector('[data-shape-id="shape:probe-child"]')), '变更父节点后未重新排层')
    raw.remove([child.id])
    await settle()
    check(!host.querySelector('[data-shape-id="shape:probe-child"]'), '删除形状未释放 DOM')
    view.unmount(); view.unmount()
    check(listeners.size === 0 && host.children.length === 0, '卸载没有释放 Store 订阅或 DOM')
    reads.clear()
    raw.put([{ ...first, x: 30 }])
    await settle()
    check(reads.size === 0, '卸载后状态订阅仍在响应 Store')
    let rejected = false
    try { view.setCamera({ x: 0, y: 0, z: 1 }) } catch { rejected = true }
    check(rejected, '卸载后接口仍允许更新相机')
    return { singleRecordUpdate: true, cameraDoesNotRereadShapes: true, nestedClipping: true, structuralChanges: true, storeSubscriptionsReleased: true, stateSubscriptionsReleased: true }
  } finally { view.unmount(); host.remove() }
}
