// Independent native legacy DOM readbacks from #180 (2026-11-26). Each row
// stores computed opacity for factors 1/4/16/64 at spacing 10; no fade formula.
const samples = [
  { zoom: .05, opacity: [0, 0, 0, .913043] },
  { zoom: .06, opacity: [0, 0, .0307692, .921739] },
  { zoom: .075, opacity: [0, 0, .0769231, .934783] },
  { zoom: .09, opacity: [0, 0, .123077, .947826] },
  { zoom: .1, opacity: [0, 0, .153846, .956522] },
  { zoom: .123, opacity: [0, 0, .224615, .976522] },
  { zoom: .125, opacity: [0, 0, .230769, .978261] },
  { zoom: .15, opacity: [0, 0, .307692, 1] },
  { zoom: .2, opacity: [0, .0588235, .461538, 1] },
  { zoom: .25, opacity: [0, .117647, .615385, 1] },
  { zoom: .267, opacity: [0, .137647, .667692, 1] },
  { zoom: .33, opacity: [0, .211765, .861538, 1] },
  { zoom: .375, opacity: [0, .264706, 1, 1] },
  { zoom: .447, opacity: [0, .349412, 1, 1] },
  { zoom: .5, opacity: [0, .411765, 1, 1] },
  { zoom: .625, opacity: [0, .558824, 1, 1] },
  { zoom: .75, opacity: [.0277778, .705882, 1, 1] },
  { zoom: .823, opacity: [.0683333, .791765, 1, 1] },
  { zoom: .875, opacity: [.0972222, .852941, 1, 1] },
  { zoom: 1, opacity: [.166667, 1, 1, 1] },
  { zoom: 1.111, opacity: [.228333, 1, 1, 1] },
  { zoom: 1.25, opacity: [.305556, 1, 1, 1] },
  { zoom: 1.5, opacity: [.444444, 1, 1, 1] },
  { zoom: 1.731, opacity: [.572778, 1, 1, 1] },
  { zoom: 1.75, opacity: [.583333, 1, 1, 1] },
  { zoom: 2, opacity: [.722222, 1, 1, 1] },
]

// Exercise the same public mount/setCamera boundary as snappingOverlayProbe.
// Rendering may change; the assertion concerns the four visible grid layers.
export async function gridFadeProbe(view, host, settle) {
  const results = []
  for (const sample of samples) {
    view.setCamera({ x: 0, y: 0, z: sample.zoom }); await settle()
    const layers = [...host.querySelectorAll('[data-grid-factor]')]
      .map(pattern => ({ factor: Number(pattern.dataset.gridFactor), opacity: Number(getComputedStyle(pattern.querySelector('circle')).opacity) }))
      .sort((a, b) => a.factor - b.factor)
    if (layers.length !== 4 || layers.some((layer, index) => layer.factor !== [1, 4, 16, 64][index])) throw new Error(`网格淡入缺少四层：${sample.zoom}`)
    const differences = layers.map((layer, index) => Math.abs(layer.opacity - sample.opacity[index]))
    for (const [index, difference] of differences.entries()) {
      if (!Number.isFinite(difference) || difference > .01) throw new Error(`网格淡入未对齐旧版：视角${sample.zoom}，层${layers[index].factor}，期望${sample.opacity[index]}，实际${layers[index].opacity}，差${difference}`)
    }
    results.push({ zoom: sample.zoom, opacity: layers.map(layer => layer.opacity), maxDifference: Math.max(...differences) })
  }
  return results
}
