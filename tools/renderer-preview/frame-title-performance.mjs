import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkTitleLayoutTrace } from './title-layout-guard.mjs'

const modulePath = '/tools/renderer-preview/frame-title-performance.js'
export async function measureFrameTitlePerformance(contents, output) {
  const evaluate = code => contents.executeJavaScript(code)
  const call = code => evaluate(`import('${modulePath}').then(module => ${code})`)
  const count = await call('module.mountTitleWorkload()'), samples = []
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Performance.enable')
    const metric = async () => Object.fromEntries((await contents.debugger.sendCommand('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
    // Warm both cases, then alternate order to expose warm-up / load drift.
    for (const hidden of [false, true]) await call(`module.runTitleFrames({hidden:${hidden},frames:30})`)
    for (const hidden of [false, true, true, false, false, true]) {
      const before = await metric(), sample = await call(`module.runTitleFrames({hidden:${hidden}})`), after = await metric()
      samples.push({ ...sample, layouts: after.LayoutCount - before.LayoutCount, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000 })
    }
    await writeFile(join(output, 'frame-title-samples.json'), JSON.stringify({ ...count, samples }, null, 2))
    // Layout roots / invalidations are retained for inspection, with backend IDs
    // of titles and all their descendants so the guard can identify their scope.
    const document = await contents.debugger.sendCommand('DOM.getDocument', { depth: -1 })
    const allowed = new Set()
    const walk = (node, inTitle = false) => {
      const attrs = node.attributes || []
      const title = inTitle || attrs.includes('data-frame-title-root')
      if (title) allowed.add(node.backendNodeId)
      for (const child of node.children || []) walk(child, title)
    }
    walk(document.root)
    const events = []
    let complete
    const done = new Promise(resolve => { complete = resolve })
    const message = (_event, method, params) => {
      if (method === 'Tracing.dataCollected') events.push(...params.value)
      if (method === 'Tracing.tracingComplete') complete()
    }
    contents.debugger.on('message', message)
    try {
      await call('module.prepareTitleFrames(false)')
      await contents.debugger.sendCommand('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,cc', transferMode: 'ReportEvents' })
      await call('module.runTitleFrames({frames:30,prepared:true})')
      await contents.debugger.sendCommand('Tracing.end'); await done
    } finally { contents.debugger.off('message', message) }
    await writeFile(join(output, 'frame-title-layout-trace.json'), JSON.stringify({ allowedTitleBackendIds: [...allowed], traceEvents: events }))
    const isolation = checkTitleLayoutTrace(events, allowed)
    const visible = samples.filter(sample => !sample.hidden), hidden = samples.filter(sample => sample.hidden)
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const ratio = median(visible.map(sample => sample.fps)) / median(hidden.map(sample => sample.fps))
    const slices = names => events.filter(event => event.ph === 'X' && names.includes(event.name))
    const activity = names => { const matching = slices(names); return { slices: matching.length, sumMs: matching.reduce((sum, event) => sum + (event.dur || 0), 0) / 1000 } }
    return { ...count, baseline: 'same records and frame bodies; title display:none; 50 subscriptions retained; diagnostic ratio only, not acceptance threshold', samples, fpsRatio: ratio, trace: { ...isolation, allowedTitleBackendIds: allowed.size, activities: { layout: activity(['Layout']), style: activity(['UpdateLayoutTree', 'RecalculateStyles']), paint: activity(['Paint']), raster: activity(['RasterTask']) }, activityUnits: 'sum of slice wall durations in ms; parallel raster threads may overlap' } }
  } finally { contents.debugger.detach(); await call('module.unmountTitleWorkload()') }
}
