import { screenToCanvas } from '../../renderer/geometry.js'
import { clampZoom } from './camera-math.js'
import { captureRecordBasis } from '../record-basis.js'
import { getRecordDependencies } from '../record-dependencies.js'

// Hosts prepare files and upload bytes; this public entry owns document intent.
// A ticket captures the revision/selection/camera before asynchronous preparation.
// #136/#176 pass file-paste results unchanged; no clipboard policy lives here.
export function createMediaImport({ session, interaction, pageId }) {
  if (!session?.store || !interaction?.state || !pageId) throw new Error('媒体导入需要编辑会话、交互与画布。')
  const blocked = state => session.state.get().isSubmitting || session.state.get().isGestureActive || state.textEditing || state.imageAltEditing || state.croppingId || state.clipboardBusy || state.mode && state.mode !== 'idle'
  return Object.freeze({
    begin({ point, replaceId = null }) {
      if (!point || ![point.x, point.y].every(Number.isFinite)) throw new Error('媒体落点需要有限坐标。')
      const initial = interaction.state.get(), revision = session.state.get().revision, selection = [...initial.selectedIds]
      if (blocked(initial) || replaceId && (selection.length !== 1 || selection[0] !== replaceId)) throw new Error('请先结束当前操作并选择待替换的媒体。')
      const intent = { type: 'media_import_target', pageId, ...(replaceId && { replaceId }) }
      const snapshot = structuredClone(session.store.getStoreSnapshot()), recordBasis = captureRecordBasis(snapshot, getRecordDependencies(snapshot, [intent]))
      const center = screenToCanvas(point, initial.camera)
      let complete = false
      return Object.freeze({
        get uploadGuard() { return structuredClone({ expectedRevision: revision, recordBasis, intent }) },
        cancel() { complete = true },
        async commit(items) {
          if (complete) throw new Error('这次媒体导入已结束。')
          complete = true
          if (!Array.isArray(items) || !items.length || replaceId && items.length !== 1) throw new Error('需要有效媒体项，替换只接受一个文件。')
          if (items.some(item => !item || ![item.w, item.h].every(n => Number.isFinite(n) && n > 0))) throw new Error('媒体尺寸无效。')
          if (items.some(item => typeof item.src !== 'string' || !item.src)) throw new Error('准备好的媒体需要有效资源地址。')
          const kinds = items.map(item => item.mimeType?.startsWith('image/') ? 'image' : item.mimeType?.startsWith('video/') ? 'video' : null)
          if (kinds.some(kind => !kind) || replaceId && session.store.get(replaceId)?.type !== kinds[0]) throw new Error('媒体类型不支持或与待替换形状不一致。')
          if (blocked(interaction.state.get()) || JSON.stringify(interaction.state.get().selectedIds) !== JSON.stringify(selection)) throw new Error('上传期间选择已变化，或开始了新的编辑操作，请重试。')
          // Native CDP chooser/drop, isolated 1280×800, 2026-11-26 (#137):
          // 320×180 + 160×320 at (550,420) → (310,260), (630,260).
          // A third 320×180 → (150,260), (470,260), (630,260). No gaps.
          const width = items.reduce((sum, item) => sum + item.w, 0), height = Math.max(...items.map(item => item.h))
          if (!Number.isFinite(width)) throw new Error('媒体尺寸无效。')
          let x = center.x - width / 2
          const commands = items.map((item, i) => {
            const kind = kinds[i]
            const command = replaceId ? { type: `replace_${kind}`, id: replaceId, [kind]: item } : { type: `insert_${kind}`, args: { pageId, x, y: center.y - height / 2, displayWidth: item.w, displayHeight: item.h, avoidOverlap: false }, [kind]: item }
            x += item.w
            return command
          })
          const result = await session.commitCommands(commands, { recordBasis })
          const viewport = initial.viewport, camera = interaction.state.get().camera
          // Observed old drop of a 1280×720 clip into 1280×800: 90% fit,
          // #137 4096×256 PNG at (550,420) → z=.28125 (90% viewport fit).
          // Never override a host camera changed during file preparation.
          if (!replaceId && viewport && interaction.setCamera && JSON.stringify(camera) === JSON.stringify(initial.camera) && (width * camera.z >= viewport.w || height * camera.z >= viewport.h)) {
            const z = clampZoom(Math.min(viewport.w / width, viewport.h / height) * .9)
            interaction.setCamera({ x: viewport.w / (2 * z) - center.x, y: viewport.h / (2 * z) - center.y, z })
          }
          return result
        },
      })
    },
  })
}
