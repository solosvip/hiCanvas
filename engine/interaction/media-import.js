import { screenToCanvas } from '../../renderer/geometry.js'
import { clampZoom } from './camera-math.js'

// Hosts prepare files and upload bytes; this public entry owns document intent.
// A ticket captures the revision/selection/camera before asynchronous preparation.
// #137 can add image commands here; #136/#176 pass file-paste results unchanged.
export function createMediaImport({ session, interaction, pageId }) {
  if (!session?.store || !interaction?.state || !pageId) throw new Error('媒体导入需要编辑会话、交互与画布。')
  return Object.freeze({
    begin({ point, replaceId = null }) {
      if (!point || ![point.x, point.y].every(Number.isFinite)) throw new Error('媒体落点需要有限坐标。')
      const initial = interaction.state.get(), revision = session.state.get().revision, selection = [...initial.selectedIds]
      if (session.state.get().isSubmitting || session.state.get().isGestureActive || replaceId && (selection.length !== 1 || selection[0] !== replaceId)) throw new Error('请先结束当前操作并选择待替换的视频。')
      const center = screenToCanvas(point, initial.camera)
      let complete = false
      return Object.freeze({
        cancel() { complete = true },
        async commit(items) {
          if (complete) throw new Error('这次媒体导入已结束。')
          complete = true
          if (!Array.isArray(items) || !items.length || replaceId && items.length !== 1) throw new Error('需要有效媒体项，替换只接受一个文件。')
          if (items.some(item => !item || ![item.w, item.h].every(n => Number.isFinite(n) && n > 0))) throw new Error('媒体尺寸无效。')
          if (session.state.get().revision !== revision || session.state.get().isSubmitting || session.state.get().isGestureActive || JSON.stringify(interaction.state.get().selectedIds) !== JSON.stringify(selection)) throw new Error('上传期间画板或选择已变化，请重试。')
          // Old native drop: intrinsic-size items form one top-aligned row,
          // without gaps; the whole row's bounds are centered on the drop point.
          const width = items.reduce((sum, item) => sum + item.w, 0), height = Math.max(...items.map(item => item.h))
          if (!Number.isFinite(width)) throw new Error('媒体尺寸无效。')
          let x = center.x - width / 2
          const commands = items.map(video => {
            const command = replaceId ? { type: 'replace_video', id: replaceId, video } : { type: 'insert_video', args: { pageId, x, y: center.y - height / 2 }, video }
            x += video.w
            return command
          })
          session.beginGesture()
          try {
            session.preview(commands)
            const result = await session.commitGesture()
            const viewport = initial.viewport, camera = interaction.state.get().camera
            // Observed old drop of a 1280×720 clip into 1280×800: 90% fit,
            // centered in the viewport. Never override a host camera changed
            // while asynchronous file preparation was in flight.
            if (!replaceId && viewport && interaction.setCamera && JSON.stringify(camera) === JSON.stringify(initial.camera) && (width * camera.z >= viewport.w || height * camera.z >= viewport.h)) {
              const z = clampZoom(Math.min(viewport.w / width, viewport.h / height) * .9)
              interaction.setCamera({ x: viewport.w / (2 * z) - center.x, y: viewport.h / (2 * z) - center.y, z })
            }
            return result
          }
          catch (error) { session.cancelGesture(); throw error }
        },
      })
    },
  })
}
