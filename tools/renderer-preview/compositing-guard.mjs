import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Static geo/text/image fixtures should share their paint layer. A trivial 3D
// camera translation can promote the first shape and a chain of overlapping
// siblings even though their computed transforms still look two-dimensional.
export async function checkShapeCompositing(contents, expectedCount) {
  const count = await contents.executeJavaScript("document.querySelectorAll('[data-shape-id]').length")
  assert.equal(count, expectedCount, '合成层检查没有加载完整的合成画板')
  const debug = contents.debugger, attachedHere = !debug.isAttached()
  let layers, enabled = false
  const message = (_event, method, params) => {
    if (method === 'LayerTree.layerTreeDidChange' && params.layers) layers = params.layers
  }
  try {
    if (attachedHere) debug.attach('1.3')
    debug.on('message', message)
    await debug.sendCommand('LayerTree.enable'); enabled = true
    // LayerTree only pushes after a compositor update. Nudge the preview's
    // session camera and restore it before inspection; shape records stay put.
    await contents.executeJavaScript(`(async () => {
      const view = window.__HICANVAS_RENDERER_PREVIEW__, original = view.getCamera();
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try { view.resetCamera({ ...original, x: original.x + 1 }); await settle() }
      finally { view.resetCamera(original); await settle() }
      if (JSON.stringify(view.getCamera()) !== JSON.stringify(original)) throw new Error('合成层检查未恢复视角');
    })()`)
    const end = Date.now() + 10000
    while (!layers && Date.now() < end) await delay(20)
    assert.ok(layers?.some(layer => layer.drawsContent && layer.backendNodeId), '没有取得实际合成层，拒绝空测通过')
    const content = layers.filter(layer => layer.drawsContent && layer.backendNodeId)
    const shapes = (await Promise.all(content.map(async layer => {
      const { object } = await debug.sendCommand('DOM.resolveNode', { backendNodeId: layer.backendNodeId })
      let id
      try {
        const { result, exceptionDetails } = await debug.sendCommand('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: "function () { const element = this.nodeType === 1 ? this : this.parentElement; return element?.closest('[data-shape-id]')?.getAttribute('data-shape-id') || null }",
          returnByValue: true,
        })
        assert.ok(!exceptionDetails, '无法确认合成层所属形状')
        id = result.value
      } finally { await debug.sendCommand('Runtime.releaseObject', { objectId: object.objectId }) }
      if (!id) return null
      const reasons = await debug.sendCommand('LayerTree.compositingReasons', { layerId: layer.layerId })
      return { id, layerId: layer.layerId, ...reasons }
    }))).filter(Boolean)
    assert.equal(shapes.length, 0, `静态形状被拆成独立合成层：${JSON.stringify(shapes)}`)
    return { totalLayers: layers.length, contentLayers: content.length, independentlyCompositedShapes: shapes.length }
  } finally {
    try { if (enabled) await debug.sendCommand('LayerTree.disable') }
    finally { debug.removeListener('message', message); if (attachedHere && debug.isAttached()) debug.detach() }
  }
}
