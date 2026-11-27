import { summarizeSamples } from './report.mjs'
import { assertPairedFixtures } from './strokes-report.mjs'
import { measurementPlan } from './config.mjs'

export function isFormalComparison(options, tracing = false) {
  return !tracing && options.renderer === 'both' && options.previewMode === 'editor' && options.runs === 3 && options.durationMs >= 2500
    && (options.workload === 'handles' ? options.sizes.length === 1 && options.sizes[0] === 5000 : [500, 2000, 5000].every(count => options.sizes.includes(count)))
}

export function comparisonVerdict(comparison, options) {
  const metrics = options.workload === 'handles' ? ['resizePaintRatio'] : ['openRatio', 'panPaintRatio', 'zoomPaintRatio', ...(options.previewMode === 'renderer' ? [] : ['dragPaintRatio'])]
  const checks = metrics.map(metric => {
    const ratio = comparison[metric], limit = metric === 'openRatio' ? 1.1 : .9
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error(`缺失或无效性能读数：${metric}`)
    return { metric, ratio, limit, pass: metric === 'openRatio' ? ratio <= limit : ratio >= limit }
  })
  return { ...comparison, checks, pass: checks.every(check => check.pass) }
}

export function comparisonSummary(samples, options) {
  const baselineSamples = samples.filter(sample => sample.stage === 'baseline')
  if (samples.some(sample => !['baseline', 'retest'].includes(sample.stage))) throw new Error('未知测量阶段。')
  const identity = rows => JSON.stringify(rows.map(({ renderer, count, repeat }) => ({ renderer, count, repeat })))
  if (identity(baselineSamples) !== identity(measurementPlan(options))) throw new Error('三轮交替样本缺失或次序错误。')
  if (options.renderer === 'both') assertPairedFixtures(samples)
  const baseline = summarizeSamples(baselineSamples, options)
  const comparisons = baseline.comparison.map(initial => {
    const retest = samples.filter(sample => sample.stage === 'retest' && sample.count === initial.count)
    const first = comparisonVerdict(initial, options)
    if (!retest.length) {
      if (options.requireRetests && !first.pass) throw new Error(`缺少即时成对复测：${initial.count}`)
      return { ...first, basis: `${options.runs}-round median` }
    }
    if (first.pass) throw new Error('没有失败的档位却追加了复测。')
    if (identity(retest) !== identity(measurementPlan({ ...options, sizes: [initial.count], runs: 1 }))) throw new Error('即时复测缺失或次序错误。')
    const current = summarizeSamples(retest, { ...options, sizes: [initial.count], runs: 1 })
    return { ...comparisonVerdict(current.comparison[0], options), initial: first, basis: 'immediate paired retest' }
  })
  return { baseline, comparisons, acceptancePassed: comparisons.length ? comparisons.every(item => item.pass) : null }
}
