import { createClipboardContent, MAX_CLIPBOARD_BYTES } from '../../engine/index.js'
import { parseExternalClipboard } from './clipboard-external.js'

// Fixtures explicitly choose private memory. Production clipboard bytes never
// enter diagnostics; the editing layer receives only ordinary format strings.
export function createPreviewClipboard({ host, transport, sandbox = false, onError = () => {} }) {
  const doc = host.ownerDocument, view = doc.defaultView
  let formats = {}, active = null, reads = 0, writes = 0
  const readTransfer = transfer => Object.fromEntries(['text/plain', 'text/html'].filter(type => transfer.types.includes(type)).map(type => [type, transfer.getData(type)]))
  const port = {
    copyContent: transport.copyContent || (({ snapshot, ids, boardId }) => createClipboardContent(snapshot, ids, { boardId })),
    async read() {
      reads++
      if (active?.clipboardData) return parseExternalClipboard(readTransfer(active.clipboardData), { document: doc })
      if (sandbox) return parseExternalClipboard(structuredClone(formats), { document: doc })
      const clipboard = view.navigator.clipboard
      if (!clipboard) throw new Error('此窗口不支持读取剪贴板。')
      if (!clipboard.read) return parseExternalClipboard({ 'text/plain': await clipboard.readText() }, { document: doc })
      const result = {}
      for (const item of await clipboard.read()) for (const type of ['text/plain', 'text/html']) if (item.types.includes(type)) {
        const blob = await item.getType(type)
        if (blob.size > MAX_CLIPBOARD_BYTES * (type === 'text/html' ? 6 : 1)) throw new Error('剪贴板内容超过大小上限。')
        result[type] = await blob.text()
      }
      return parseExternalClipboard(result, { document: doc })
    },
    async write(value) {
      writes++
      if (sandbox) {
        formats = structuredClone(value)
        if (active?.clipboardData) for (const [type, text] of Object.entries(value)) active.clipboardData.setData(type, text)
        return
      }
      const clipboard = view.navigator.clipboard
      if (!clipboard) throw new Error('此窗口不支持写入剪贴板。')
      if (!clipboard.write) return clipboard.writeText(value['text/plain'])
      const data = Object.fromEntries(Object.entries(value).map(([type, text]) => [type, new view.Blob([text], { type })]))
      await clipboard.write([new view.ClipboardItem(data)])
    },
  }
  return {
    port,
    inspect: () => sandbox ? { reads, writes, formats: structuredClone(formats) } : null,
    attach(interaction, { onFiles } = {}) {
      const handle = event => {
        if (active || event.defaultPrevented) return
        const files = event.type === 'paste' && onFiles && [...(event.clipboardData?.files || [])]
        active = event
        try {
          let result
          if (files?.length) {
            const target = interaction.getFilePasteTarget()
            if (target.status === 'unavailable') { active = null; return }
            // Files stay in the host. The editing layer owns focus/IME gates
            // and the same cursor preference as ordinary clipboard actions.
            result = onFiles(files, target.point)
          } else result = interaction.runAction(event.type)
          if (result?.status === 'unavailable') { active = null; return }
          event.preventDefault()
          Promise.resolve(result).catch(onError).finally(() => { if (active === event) active = null })
        } catch (error) { active = null; onError(error) }
      }
      for (const type of ['copy', 'cut', 'paste']) doc.addEventListener(type, handle)
      return () => { active = null; for (const type of ['copy', 'cut', 'paste']) doc.removeEventListener(type, handle) }
    },
  }
}
