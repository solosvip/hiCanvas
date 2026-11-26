// Geometry needs the same family names, without importing browser loaders or
// asset URLs. Keep each generic fallback aligned with the observed old editor.
export const canvasFonts = Object.freeze({
  draw: '"hiCanvas Draw", sans-serif', sans: '"hiCanvas Sans", sans-serif',
  serif: '"hiCanvas Serif", serif', mono: '"hiCanvas Mono", monospace',
})

export function canvasFontFamily(key) { return canvasFonts[key] || canvasFonts.draw }

// Author Shantell 1.011, C instances fitted against black-box legacy output.
// CSS roles remain 400/700 for fallback fonts; wght overrides only Shantell.
export const drawFontAxes = Object.freeze({
  '400/normal': Object.freeze({ wght: 598, ital: 0, INFM: 78, BNCE: 0, SPAC: 0.42114903446518603 }),
  '400/italic': Object.freeze({ wght: 608, ital: 1, INFM: 78, BNCE: 0, SPAC: 0.04366731968538143 }),
  '700/normal': Object.freeze({ wght: 780, ital: 0, INFM: 78, BNCE: 0, SPAC: 0.4735631847820185 }),
  '700/italic': Object.freeze({ wght: 794, ital: 1, INFM: 78, BNCE: 0, SPAC: 0.11716951892431526 }),
})

export function canvasFontStyle(font = 'sans', weight = 400, style = 'normal') {
  const axes = font === 'draw' && drawFontAxes[`${weight}/${style}`]
  return { fontFamily: canvasFontFamily(font), fontWeight: weight, fontStyle: style, textSpacingTrim: 'space-all', textAutospace: 'no-autospace',
    fontVariationSettings: axes ? Object.entries(axes).map(([tag, value]) => `"${tag}" ${value}`).join(', ') : 'normal' }
}
