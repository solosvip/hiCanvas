import { createSnapshotOutput } from './snapshot-output.js'

// Read-only output owns no document transaction. Browser and desktop adapters
// receive a complete result only after the fixed snapshot has finished rendering.
export function createCanvasExport({ session, interaction, render, download, background }) {
  if (!session?.store || !interaction?.state || typeof render !== 'function' || typeof download !== 'function' || typeof background !== 'string' || !background.trim()) throw new Error('画布输出需要会话、交互、渲染、下载与背景颜色。')
  const output = createSnapshotOutput({ session, interaction })
  let withBackground = true
  async function run({ format = 'png', scope = 'selection', origin = 'canvas', signal, ...options } = {}) {
    if (!['svg', 'png'].includes(format) || !['selection', 'all'].includes(scope) || !['canvas', 'toolbar'].includes(origin)) throw new Error('输出格式、范围或动作来源无效。')
    return output.run({ origin, signal }, async ({ snapshot, selected, signal, check }) => {
      const result = await render(snapshot, { ...options, format, ids: scope === 'selection' && selected.length ? selected : undefined, background: withBackground ? background : null, signal })
      check()
      if (result.status === 'empty') return result
      if (result.status !== 'complete' || !(result.bytes instanceof Uint8Array) || !result.bytes.length) throw new Error('输出结果不完整。')
      await download(result, { filename: `hiCanvas.${format}`, signal })
      return result
    })
  }
  return Object.freeze({ state: Object.freeze({ get: () => Object.freeze({ ...output.read(), background: withBackground }) }), run, cancel: output.cancel,
    setBackground(value) { output.assertActive(); if (typeof value !== 'boolean') throw new Error('背景开关需要布尔值。'); withBackground = value },
    dispose: output.dispose,
  })
}
