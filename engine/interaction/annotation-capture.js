import { createSnapshotOutput } from './snapshot-output.js'
import { annotationPlan, checkAnnotationSize } from './annotation-plan.js'

// Inject renderer public ports. The engine owns no DOM, download, model,
// clipboard or saved asset; every call takes a fresh fixed target snapshot.
export function createCanvasAnnotationCapture({ session, interaction, preflight, render }) {
  if (!session?.store || !interaction?.state || typeof preflight !== 'function' || typeof render !== 'function') throw new Error('标注截图需要会话、交互、预检和渲染接口。')
  const output = createSnapshotOutput({ session, interaction })
  async function run({ targetId, origin = 'canvas', signal } = {}) {
    if (typeof targetId !== 'string' || !targetId) throw new Error('标注截图需要明确的目标ID。')
    return output.run({ origin, signal }, async ({ snapshot, signal, check }) => {
      const plan = annotationPlan(snapshot, targetId), options = { ids: plan.ids, pageId: plan.pageId, bounds: plan.bounds, padding: plan.padding, scale: plan.scale, format: 'png', background: 'white', signal }
      let size
      try { size = preflight(snapshot, options) }
      catch (error) {
        if (error.code === 'export-size-limit') checkAnnotationSize(error)
        throw error
      }
      if (size.status === 'empty') return size
      checkAnnotationSize(size); check()
      const result = await render(snapshot, options)
      check()
      if (result.status !== 'complete' || result.mime !== 'image/png' || !(result.bytes instanceof Uint8Array) || !result.bytes.length || result.width !== size.width || result.height !== size.height) throw new Error('标注截图结果不完整或与预检尺寸不一致。')
      return { ...result, targetId, ids: Object.freeze([...plan.ids]), sourceBounds: Object.freeze({ ...plan.bounds }), padding: plan.padding }
    })
  }
  return Object.freeze({ state: Object.freeze({ get: output.read }), run, cancel: output.cancel, dispose: output.dispose })
}
