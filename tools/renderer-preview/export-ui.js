import { createCanvasExport } from '../../engine/index.js'
import { renderCanvasExport } from '../../renderer/index.js'

export function attachExportUi(toolbar, host, session, interaction, onError) {
  const doc = host.ownerDocument, buttons = [], listeners = [], history = []
  let disposed = false
  const exporter = createCanvasExport({ session, interaction,
    background: doc.defaultView.getComputedStyle(host).getPropertyValue('--color-surface').trim(),
    render: (snapshot, options) => renderCanvasExport(snapshot, { ...options, document: doc, host }),
    async download(result, { filename, signal }) {
      signal.throwIfAborted()
      const blob = new Blob([result.bytes], { type: result.mime }), url = doc.defaultView.URL.createObjectURL(blob), link = doc.createElement('a')
      try {
        link.href = url; link.download = filename; doc.body.append(link)
        signal.throwIfAborted(); link.click()
        history.push({ filename, mime: result.mime, bounds: result.bounds, width: result.width, height: result.height, bytes: result.bytes.length, blockedResources: result.blockedResources, failedResources: result.failedResources, warnings: result.warnings })
        await new Promise(resolve => setTimeout(resolve, 0))
      } finally { link.remove(); doc.defaultView.URL.revokeObjectURL(url) }
    },
  })
  const update = () => { for (const button of buttons) button.disabled = disposed || exporter.state.get().busy }
  const listen = (element, type, handler) => { element.addEventListener(type, handler); listeners.push(() => element.removeEventListener(type, handler)) }
  const run = async options => {
    try { const pending = exporter.run(options); update(); const result = await pending; if (result.status === 'empty') status.textContent = '画板为空，没有下载文件。'; else status.textContent = result.status === 'complete' ? ['输出完成', ...(result.warnings || [])].join('；') : result.message || '输出不可用'; }
    catch (error) { status.textContent = `输出失败：${error.message}（拦截 ${error.blockedResources || 0}，失败 ${error.failedResources || 0}）`; onError(error) }
    finally { update() }
  }
  for (const [scope, format, label] of [['selection', 'svg', '下载 SVG'], ['selection', 'png', '下载 PNG'], ['all', 'svg', '全部 SVG'], ['all', 'png', '全部 PNG']]) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.export = `${scope}-${format}`
    listen(button, 'click', () => { void run({ scope, format, origin: 'toolbar' }) }); buttons.push(button); toolbar.append(button)
  }
  const background = doc.createElement('button'); background.type = 'button'; background.textContent = '输出背景'; background.dataset.export = 'background'; background.setAttribute('aria-pressed', 'true')
  listen(background, 'click', () => { exporter.setBackground(!exporter.state.get().background); background.setAttribute('aria-pressed', String(exporter.state.get().background)) })
  toolbar.append(background); buttons.push(background)
  const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消输出'; cancel.dataset.export = 'cancel'
  listen(cancel, 'click', () => exporter.cancel()); toolbar.append(cancel)
  const status = doc.createElement('output'); status.setAttribute('role', 'status'); status.dataset.exportStatus = ''; toolbar.append(status)
  return { inspect: () => ({ ...exporter.state.get(), history: structuredClone(history), message: status.textContent }), dispose() { disposed = true; exporter.dispose(); for (const stop of listeners) stop(); for (const node of [...buttons, cancel, status]) node.remove() } }
}
