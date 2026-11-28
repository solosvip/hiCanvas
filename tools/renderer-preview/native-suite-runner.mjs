import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

async function waitUntilReady(contents) {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    const state = await contents.executeJavaScript('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
    if (state?.error) throw new Error(state.error)
    if (state?.ready) return
    await delay(20)
  }
  throw new Error('等待渲染器就绪超时。')
}

// The caller owns the current-window reference and app exit. Publishing the
// window inside createWindow lets its existing catch retain failure.png even
// when preparation, navigation, a later sample or result I/O throws here.
export async function runNativeSuite(suite, context) {
  if (!suite || suite.legacy) return false
  const { manifest, samples, errors, blocked } = context
  const execution = { ...context }
  if (suite.open) {
    const opened = await suite.open(execution)
    execution.window = opened.window; execution.prepared = opened.prepared
  } else {
    execution.window = context.createWindow(suite.key)
    execution.prepared = await suite.prepare?.(execution)
  }
  const { window } = execution
  await window.loadURL(`${manifest.url}/?${suite.query}`)
  await waitUntilReady(window.webContents)
  for (const fields of suite.samples) {
    const sample = {}
    for (const [key, run] of Object.entries(fields)) sample[key] = await run(execution)
    // Push each completed sample now. Never lose an earlier successful stage
    // when a later one fails, nor publish half an object before all its fields.
    samples.push(sample)
  }
  const failures = { errors, blocked }
  if (suite.guardCalls) failures[suite.guardKey || 'calls'] = suite.guardCalls(execution)
  if (Object.values(failures).some(calls => calls.length)) throw new Error(JSON.stringify(failures))
  const reportValue = field => field === 'runtime' ? process.versions : field === 'pid' ? process.pid : manifest[field]
  const report = Object.fromEntries((suite.reportBefore || []).map(field => [field, reportValue(field)]))
  Object.assign(report, { samples, errors, blocked })
  for (const field of suite.report) report[field] = reportValue(field)
  await writeFile(manifest.result, JSON.stringify(report, null, 2))
  return true
}
