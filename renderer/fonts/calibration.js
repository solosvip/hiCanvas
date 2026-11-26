import { canvasFontStyle } from '../font-families.js'
import { fallbackAdvance, FALLBACK_UNITS } from '../text-fallback.js'

// Synthetic class probes only: never log document text or user font files.
export function checkTextCalibration(target, onWarning) {
  const probe = target.createElement('span'), warnings = []
  Object.assign(probe.style, { position: 'absolute', left: '-10000px', top: 0, width: 'max-content', whiteSpace: 'pre', fontSize: '24px', textSpacingTrim: 'space-all', textAutospace: 'no-autospace' })
  ;(target.body || target.documentElement).append(probe)
  try {
    for (const font of ['sans', 'serif', 'mono', 'draw']) for (const weight of [400, 700]) for (const style of ['normal', 'italic']) {
      Object.assign(probe.style, canvasFontStyle(font, weight, style))
      for (const sample of ['天', 'あ', 'ｱ', '한', '😀', '。']) {
        probe.textContent = sample
        const actual = probe.getBoundingClientRect().width, expected = fallbackAdvance(sample, font, style, new Set()) * 24 / FALLBACK_UNITS
        if (Math.abs(actual - expected) > .5) warnings.push({ font, weight, style, sample, actual, expected })
      }
    }
  } finally { probe.remove() }
  if (warnings.length) {
    const diagnostic = { kind: 'text-layout-calibration', warnings }
    target.defaultView.console.warn('画板系统字体校准偏差超过0.5px，请复核本机字体版本。', diagnostic)
    // The host owns persistent logging. A failed logger must not stop opening.
    if (onWarning) void Promise.resolve().then(() => onWarning(diagnostic)).catch(error => target.defaultView.console.warn('文字校准日志未能保存。', error))
  }
  return warnings
}
