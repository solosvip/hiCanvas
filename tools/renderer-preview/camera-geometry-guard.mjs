import assert from 'node:assert/strict'
import { checkClipPixels } from './clip-pixel-guard.mjs'

// Exercise the two mathematically identical camera forms and SVG clipping
// independently of pixels: raster edge coverage can differ between paint layers.
export async function checkCameraGeometry(contents, expectedCount, evidence) {
  assert.ok(Number.isInteger(expectedCount) && expectedCount > 0, '几何检查需要非空合成画板')
  const result = await contents.executeJavaScript(`(async () => {
    const world = document.querySelector('[data-renderer-world]');
    if (!world) throw new Error('几何检查没有相机层');
    const nodes = [...document.querySelectorAll('[data-shape-id]')];
    if (nodes.length !== ${JSON.stringify(expectedCount)}) throw new Error('几何检查没有加载完整合成画板');
    const svgs = [...document.querySelectorAll('[data-shape-type=geo] > svg')];
    // CSS text serialization rounds fractional scales; preserve the actual
    // numeric transform so this probe cannot move shapes while restoring them.
    const clips = svgs.map(svg => svg.style.clipPath), original = world.attributeStyleMap.get('transform');
    if (!original?.toMatrix) throw new Error('几何检查需要保留原始数值变换的CSS Typed OM');
    const { x, y, z } = window.__HICANVAS_RENDERER_PREVIEW__.getCamera();
    const legacy = 'scale(' + z + ') translate3d(' + x + 'px, ' + y + 'px, 0)';
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const geometry = () => JSON.stringify(nodes.map(node => {
      const box = node.firstElementChild?.getBoundingClientRect();
      return { id: node.dataset.shapeId, body: box && [box.x, box.y, box.width, box.height], paths: [...node.querySelectorAll('svg path')].map(path => path.getAttribute('d')) };
    }));
    const initial = geometry(), states = [];
    try {
      for (const candidate of [false, true, false]) {
        if (candidate) world.attributeStyleMap.set('transform', original);
        else world.style.transform = legacy;
        svgs.forEach((svg, i) => { svg.style.clipPath = candidate ? clips[i] : '' });
        await settle(); states.push(geometry());
      }
    } finally {
      world.attributeStyleMap.set('transform', original);
      svgs.forEach((svg, i) => { svg.style.clipPath = clips[i] });
      await settle();
    }
    states.push(geometry());
    const stable = states.every(state => state === initial);
    const index = states.findIndex(state => state !== initial);
    const a = JSON.parse(initial), b = index < 0 ? [] : JSON.parse(states[index]);
    const changed = b.findIndex((shape, i) => JSON.stringify(shape) !== JSON.stringify(a[i]));
    return { shapeCount: nodes.length, geoCount: svgs.length, stable, ...(!stable ? { phase: index, original: String(original), camera: {x,y,z}, before: a[changed], after: b[changed] } : {}) };
  })()`)
  assert.equal(result.shapeCount, expectedCount)
  assert.equal(result.stable, true, '相机形式或SVG裁剪改变了外框或矢量路径：' + JSON.stringify(result))
  return { ...result, clipPixels: await checkClipPixels(contents, evidence) }
}
