import { join } from 'node:path'
import { scratchPath } from './config.mjs'

// Opt-in diagnosis only (HICANVAS_PERF_TRACE=1). Tracing perturbs timing; keep
// these samples separate from the uninstrumented acceptance measurements.
export async function startPhaseTrace({ tracing, contents, outputDir, label }) {
  const path = await scratchPath(join(outputDir, `${label}.trace.json`))
  const debug = contents.debugger
  const attachedHere = !debug.isAttached()
  let before, recording = false
  const stop = async () => {
    try { if (recording) await tracing.stopRecording(path) }
    finally { if (attachedHere && debug.isAttached()) debug.detach() }
  }
  try {
    if (attachedHere) debug.attach('1.3')
    await debug.sendCommand('Performance.enable')
    before = await debug.sendCommand('Performance.getMetrics')
    await tracing.startRecording({ record_mode: 'record-continuously', included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink', 'blink.user_timing', 'cc', 'gpu', 'viz'] })
    recording = true
    await contents.executeJavaScript("performance.mark('hiCanvas-perf-start'); void 0")
  } catch (error) { await stop().catch(() => {}); throw error }
  let stopped
  return () => stopped ||= (async () => {
    let after
    try {
      await contents.executeJavaScript("performance.mark('hiCanvas-perf-end'); void 0")
      after = await debug.sendCommand('Performance.getMetrics')
    } finally { await stop() }
    const previous = Object.fromEntries(before.metrics.map(m => [m.name, m.value]))
    return { path, metricsDelta: Object.fromEntries(after.metrics.filter(m => m.name.endsWith('Duration') || m.name.endsWith('Count')).map(m => [m.name, m.value - (previous[m.name] || 0)])) }
  })()
}
