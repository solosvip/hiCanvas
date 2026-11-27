import { externalClipboardCases } from './clipboard-fixture.js'

// Mounted only on the host-created synthetic clipboard gallery. Paste itself
// still crosses the production document listener and ordinary public actions.
export function createExternalClipboardProbe({ session, interaction, document, onError }) {
  const view = document.defaultView, cases = externalClipboardCases(view.location.origin)
  const text = node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : (node.content || []).map(text).join(node.type === 'doc' ? '\n' : '')
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  view.__hicanvasExternalExecuted = 0
  return Object.freeze({
    cases: () => cases.map(({ formats: _formats, ...description }) => description),
    paste(name) {
      const fixture = cases.find(item => item.name === name)
      if (!fixture) throw new Error('未知的合成剪贴板夹具。')
      const transfer = new view.DataTransfer()
      for (const [type, value] of Object.entries(fixture.formats)) transfer.setData(type, value)
      const event = new view.ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true, composed: true })
      document.activeElement.dispatchEvent(event)
      return { trusted: event.isTrusted, prevented: event.defaultPrevented }
    },
    async inspect() {
      const records = session.store.allRecords().filter(record => ['shape', 'binding', 'asset'].includes(record.typeName)).sort((a, b) => a.id.localeCompare(b.id))
      const digest = await view.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(records))))
      return { revision: session.state.get().revision, signature: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''),
        count: records.filter(record => record.typeName === 'shape').length, executionCount: view.__hicanvasExternalExecuted, runtimeError: session.state.get().lastError,
        selectedText: interaction.state.get().selectedIds.map(id => session.store.get(id)).filter(record => record?.type === 'text').map(record => text(record.props.richText)), status: document.querySelector('#status').textContent }
    },
    async failCommit() {
      // An ordinary public command rejected by the isolated host leaves a
      // genuine runtime error. Never mutate the state atom to manufacture it.
      try { await session.commitCommands([{ type: 'update', id: 'shape:synthetic-missing', changes: { x: 1 } }]) }
      catch { return { runtimeError: session.state.get().lastError } }
      throw new Error('合成的不存在对象更新没有被拒绝。')
    },
    reportHostError() { onError(new Error('Synthetic host feedback failure')) },
    async prepareContainers() {
      await session.commitCommands([
        { type: 'create_shape', id: 'shape:external-frame', shapeType: 'frame', x: 500, y: 250, props: { w: 450, h: 400 } },
        { type: 'create_shape', id: 'shape:external-group', shapeType: 'group' },
        { type: 'create_shape', id: 'shape:external-child', shapeType: 'geo', parentId: 'shape:external-group', x: 100, y: 100, props: { w: 60, h: 60, fill: 'solid' } },
      ])
      interaction.select('clear')
    },
  })
}
