import { getContentChannel } from '../../content-channel/index.js'
import { renderCanvasExport } from '../../renderer/index.js'

export function installFlattenProbe({ host, session, interaction, transport }) {
  const mediaReady = () => session.store.allRecords().filter(r => r.typeName === 'shape' && r.type === 'embed').every(shape => {
    const iframe = [...host.querySelectorAll('iframe[data-embed-content]')].find(node => node.dataset.embedContent === shape.id)
    return iframe && !!getContentChannel(iframe)
  })
  const api = Object.freeze({
    mediaReady,
    read: () => ({ document: structuredClone(session.store.getStoreSnapshot('document')), state: structuredClone(interaction.state.get()), revision: session.state.get().revision, submitting: session.state.get().isSubmitting, commits: transport.getCommitCount?.() ?? null, availability: interaction.getFlatten() }),
    // Read-only public output. The harness compares before/after pixels and
    // known color regions; no editing API or writable object crosses this seam.
    async capture() {
      if (!mediaReady()) throw new Error('内容通道尚未就绪。')
      const snapshot = structuredClone(session.store.getStoreSnapshot('document'))
      const result = await renderCanvasExport(snapshot, { scope: 'all', bounds: { x: 0, y: 0, w: 1280, h: 800 }, format: 'png', scale: 1, document: host.ownerDocument, host })
      if (result.status !== 'complete') return result
      let binary = ''
      for (let start = 0; start < result.bytes.length; start += 32768) binary += String.fromCharCode(...result.bytes.subarray(start, start + 32768))
      return { bounds: result.bounds, width: result.width, height: result.height, scale: result.scale, mime: result.mime, base64: btoa(binary), warnings: result.warnings, blockedResources: result.blockedResources, failedResources: result.failedResources }
    },
  })
  Object.defineProperty(globalThis, '__HICANVAS_FLATTEN_PROBE__', { value: api, configurable: true })
  return () => { delete globalThis.__HICANVAS_FLATTEN_PROBE__ }
}
