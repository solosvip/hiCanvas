import { median, measurementPlan } from './config.mjs'

export function summarizeSamples(samples, options) {
  const planned = measurementPlan(options)
  if (samples.length !== planned.length) throw new Error('样本总数与测量计划不符。')
  for (const expected of planned) {
    if (samples.filter(s => s.renderer === expected.renderer && s.count === expected.count && s.repeat === expected.repeat).length !== 1) throw new Error(`样本缺失或重复：${expected.renderer}/${expected.count}/${expected.repeat}`)
  }
  const summary = planned.filter(s => s.repeat === 1).map(({ renderer, count }) => {
    const group = samples.filter(s => s.renderer === renderer && s.count === count)
    const phases = Object.fromEntries(['pan', 'zoom', 'drag'].map(name => {
      const applicable = group.map(s => s.phases[name].applicable !== false)
      if (applicable.some(value => value !== applicable[0])) throw new Error(`各轮操作适用性不一致：${renderer}/${count}/${name}`)
      return [name, !applicable[0] ? { applicable: false, reason: group[0].phases[name].reason }
        : Object.fromEntries(['raf', 'paint'].map(kind => [kind, { medianFps: median(group.map(s => s.phases[name][kind].fps)), medianP95FrameMs: median(group.map(s => s.phases[name][kind].p95FrameMs)) }]))]
    }))
    return { renderer, count, samples: group.length, counts: group[0].counts, assetCount: group[0].assetCount, medianOpenMs: median(group.map(s => s.openMs)), phases }
  })
  const comparison = options.renderer === 'both' ? options.sizes.map(count => {
    const legacy = summary.find(s => s.renderer === 'legacy' && s.count === count), preview = summary.find(s => s.renderer === 'preview' && s.count === count)
    return { count, openRatio: preview.medianOpenMs / legacy.medianOpenMs, panPaintRatio: preview.phases.pan.paint.medianFps / legacy.phases.pan.paint.medianFps, zoomPaintRatio: preview.phases.zoom.paint.medianFps / legacy.phases.zoom.paint.medianFps, dragPaintRatio: preview.phases.drag.applicable === false || legacy.phases.drag.applicable === false ? null : preview.phases.drag.paint.medianFps / legacy.phases.drag.paint.medianFps }
  }) : []
  return { summary, comparison }
}
