import { preflightCanvasExport, renderCanvasExport } from '../../renderer/index.js'
import { createMediaUploadAttempt } from './media-upload-attempt.js'

// Format is one capability setting, shared by preflight, rendering and upload.
// Its final value follows the separately measured SVG sanitizer pixel evidence.
export function createFlattenUpload({ metadata, document, host, format }) {
  if (!metadata.persistent || !/^[0-9a-f-]{36}$/.test(metadata.conversationId) || !['svg', 'png'].includes(format)) throw new Error('扁平化需要隔离画板和明确输出格式。')
  return Object.freeze({ format,
    preflight: preflightCanvasExport,
    render: (snapshot, options) => renderCanvasExport(snapshot, { ...options, document, host }),
    begin({ signal }) {
      const attempt = createMediaUploadAttempt({ metadata, fileCount: 1, signal })
      return Object.freeze({
        async upload(result) {
          signal.throwIfAborted()
          if (!(result.bytes instanceof Uint8Array) || !result.bytes.length || result.mime !== (format === 'svg' ? 'image/svg+xml' : 'image/png')) throw new Error('扁平化渲染回执无效。')
          let binary = ''
          for (let start = 0; start < result.bytes.length; start += 32768) binary += String.fromCharCode(...result.bytes.subarray(start, start + 32768))
          let dataUrl = `data:${result.mime};base64,${btoa(binary)}`
          const warnings = new Set(result.warnings || [])
          if (format === 'svg') {
            const prepared = await attempt.request({ purpose: 'file-import-prepare', dataUrl })
            signal.throwIfAborted()
            if (typeof prepared.dataUrl !== 'string' || !prepared.dataUrl.startsWith('data:image/svg+xml;base64,')) throw new Error('SVG准备回执无效。')
            dataUrl = prepared.dataUrl
            for (const warning of prepared.warnings || []) warnings.add(warning)
          }
          const saved = await attempt.request({ purpose: 'file-import', dataUrl })
          signal.throwIfAborted()
          const prefix = `/c/${metadata.conversationId}/assets/`
          if (typeof saved.src !== 'string' || !saved.src.startsWith(prefix) || !new RegExp(`^[a-zA-Z0-9_-]+-media-import-[a-zA-Z0-9_-]+\\.${format}$`).test(saved.src.slice(prefix.length)) || saved.mimeType !== result.mime || saved.w !== result.width || saved.h !== result.height || saved.isAnimated !== false) throw new Error('扁平化上传回执与画板、尺寸或格式不符。')
          for (const warning of saved.warnings || []) warnings.add(warning)
          return { src: saved.src, w: saved.w, h: saved.h, mimeType: saved.mimeType, isAnimated: false, warnings: [...warnings] }
        },
        abort: attempt.abort,
      })
    },
  })
}
