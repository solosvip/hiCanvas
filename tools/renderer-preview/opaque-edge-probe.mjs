import assert from 'node:assert/strict'
import { measureOpaqueCoverage } from './opaque-edge-rules.mjs'

export async function collectOpaqueEdgeProofs(contents, points, captureStill, images, size) {
  const call = (name, value) => contents.executeJavaScript(`import('/tools/renderer-preview/clip-pixel-mask.js').then(module => module.${name}(${value === undefined ? '' : JSON.stringify(value)}))`)
  const candidates = () => contents.executeJavaScript(`import('/tools/renderer-preview/opaque-edge-candidates.js').then(module => module.readOpaqueEdgeCandidates(${JSON.stringify(points)}))`)
  const search = await candidates(), proofs = [], sampling = []
  const groups = Map.groupBy(search.candidates, point => point.shape.id)
  for (const [id, group] of groups) {
    const states = new Map(group.map(point => [point, []]))
    // The first clip pass already checked the adversarial overlap probes. Do
    // not introduce new opaque paint after this pass checked owner visibility.
    await call('beginClipPixelProbe', { overflowProbe: false })
    try {
      for (const clipped of [false, true]) {
        let selected
        for (let cycle = 0; cycle < 6; cycle++) {
          for (const [index, color] of ['black', 'white'].entries()) {
            const repeat = cycle * 2 + index, name = `opaque-${sampling.length}-${Number(clipped)}-${repeat}`
            await call('setClipPixelMode', { clipped, maskId: id, color })
            images[name] = await captureStill(name)
            assert.deepEqual(images[name].getSize(), size)
            assert.equal(images[name].toBitmap().length, size.width * size.height * 4)
          }
          if (!cycle) continue
          const frames = [(cycle - 1) * 2, (cycle - 1) * 2 + 1, cycle * 2, cycle * 2 + 1].map(repeat => images[`opaque-${sampling.length}-${Number(clipped)}-${repeat}`].toBitmap())
          selected = group.map(point => {
            const offset = (point.y * size.width + point.x) * 4
            const colors = frames.map(bytes => [bytes[offset + 2], bytes[offset + 1], bytes[offset], bytes[offset + 3]])
            return { clipped, colors, cycleIndices: [cycle - 1, cycle] }
          })
          // Warm the complete black/white cycle; never search nonadjacent pairs.
          if (selected.every(state => measureOpaqueCoverage(state.colors).stable)) break
        }
        group.forEach((point, i) => states.get(point).push(selected[i]))
      }
    } finally { assert.equal(await call('endClipPixelProbe'), true, '不透明边缘颜色响应未恢复画面') }
    for (const point of group) proofs.push({ x: point.x, y: point.y, shape: point.shape, states: states.get(point) })
    sampling.push({ owner: id, pointCount: group.length, cycles: states.get(group[0]).map(state => state.cycleIndices) })
  }
  assert.deepEqual(await candidates(), search, '不透明边缘取证期间形状或遮挡关系改变')
  return { proofs, search, sampling }
}
