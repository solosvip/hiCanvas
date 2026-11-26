// Geometry needs the same family names, without importing browser loaders or
// asset URLs. Keep each generic fallback aligned with the observed old editor.
export const canvasFonts = Object.freeze({
  draw: '"hiCanvas Draw", sans-serif', sans: '"hiCanvas Sans", sans-serif',
  serif: '"hiCanvas Serif", serif', mono: '"hiCanvas Mono", monospace',
})

export function canvasFontFamily(key) { return canvasFonts[key] || canvasFonts.draw }
