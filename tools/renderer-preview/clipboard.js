import { createClipboardContent, MAX_CLIPBOARD_BYTES } from '../../engine/index.js'

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
      if (active?.clipboardData) return readTransfer(active.clipboardData)
      if (sandbox) return structuredClone(formats)
      const clipboard = view.navigator.clipboard
      if (!clipboard) throw new Error('此窗口不支持读取剪贴板。')
      if (!clipboard.read) return { 'text/plain': await clipboard.readText() }
      const result = {}
      for (const item of await clipboard.read()) for (const type of ['text/plain', 'text/html']) if (item.types.includes(type)) {
        const blob = await item.getType(type)
        if (blob.size > MAX_CLIPBOARD_BYTES * (type === 'text/html' ? 6 : 1)) throw new Error('剪贴板内容超过大小上限。')
        result[type] = await blob.text()
      }
      return result
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
    attach(interaction) {
      const handle = event => {
        if (active) return
        active = event
        try {
          const result = interaction.runAction(event.type)
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
