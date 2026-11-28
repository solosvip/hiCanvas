import { compareClipPixels } from './clip-pixel-comparison.mjs'

export function parseClipZoom(args) {
  if (!args.length) return 1
  if (args.length !== 2 || args[0] !== '--zoom') throw new Error('用法：clip-visibility-check.mjs [--zoom 正倍率]。')
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(args[1])) throw new Error('诊断倍率必须是正的有限十进制数。')
  const zoom = Number(args[1])
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('诊断倍率必须是正的有限十进制数。')
  return zoom
}

export function measureClipRestoration(before, after) {
  // Every pixel is opaque here: a translucent/AA allowance from the clipping
  // gate must never turn restoration noise into equality. The common comparer
  // validates dimensions and byte lengths before classifying any pixel.
  const mask = new Uint8Array(Math.floor(before.bytes.length / 4))
  const result = compareClipPixels(before, after, after, mask).clipped.opaque
  return { width: before.width, height: before.height, ...result, equal: result.changedPixels === 0 }
}

// Serialized into the synthetic page. This reader performs no probe, DOM
// mutation or camera reset; capture equality and state equality stay separate.
export function readClipRestorationState() {
  const world = document.querySelector('[data-renderer-world]'), transform = world?.attributeStyleMap.get('transform')
  const bounds = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height } }
  return {
    camera: window.__HICANVAS_RENDERER_PREVIEW__.getCamera(),
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    world: world && { style: world.getAttribute('style'), matrix: transform?.toMatrix && Array.from(transform.toMatrix().toFloat64Array()), computed: getComputedStyle(world).transform, bounds: bounds(world) },
    svgs: [...document.querySelectorAll('[data-shape-type=geo] > svg')].map(node => ({ id: node.parentElement.dataset.shapeId, clip: node.style.clipPath, bounds: bounds(node) })),
    fonts: { status: document.fonts.status, faces: [...document.fonts].map(font => ({ family: font.family, weight: font.weight, status: font.status })) },
    images: [...document.images].map(node => ({ src: node.currentSrc || node.src, complete: node.complete, width: node.naturalWidth, height: node.naturalHeight })),
    animations: document.getAnimations().map(animation => ({ state: animation.playState, time: animation.currentTime, pending: animation.pending })),
    document: document.documentElement.outerHTML,
  }
}
