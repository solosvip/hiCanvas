let active

const boxOf = box => ({ x: box.x, y: box.y, width: box.width, height: box.height })
const opacityOf = node => {
  let opacity = 1
  for (let parent = node; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity)
  return opacity
}

export function beginClipPixelProbe({ overflowProbe = true } = {}) {
  if (active) throw new Error('裁剪像素检查已在运行')
  const world = document.querySelector('[data-renderer-world]')
  if (!world) throw new Error('裁剪像素检查没有实际相机')
  let probe
  const existing = [...document.querySelectorAll('[data-shape-type=geo] > svg')]
  if (overflowProbe && existing.some(svg => opacityOf(svg) > 0 && opacityOf(svg) < 1)) {
    // The opaque stroke extends beyond its 10px viewport into translucent ink.
    // The mask must reject this overlap even though viewport boxes miss it.
    probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:8px;top:50vh;z-index:2147483647;pointer-events:none'
    probe.innerHTML = '<div data-shape-id="shape:clip-mask-opaque-probe" data-shape-type="geo" style="position:absolute"><svg width="10" height="10" overflow="visible"><rect width="10" height="10" fill="none" stroke="black" stroke-width="8"/></svg><div style="position:absolute;left:12px;top:-14px;width:2px;height:2px;background:black"></div></div><div data-shape-id="shape:clip-mask-semi-probe" data-shape-type="geo" style="position:absolute;opacity:.4"><svg width="24" height="24" overflow="visible"><rect x="12" y="4" width="2" height="2" fill="blue"/><rect x="12" y="-14" width="2" height="2" fill="blue"/></svg></div>'
    document.body.append(probe)
  }
  try {
    const svgs = [...document.querySelectorAll('[data-shape-type=geo] > svg')]
    const nodes = [...document.querySelectorAll('[data-shape-id]')]
    const semi = svgs.filter(svg => { const opacity = opacityOf(svg); return opacity > 0 && opacity < 1 })
    const semiNodes = new Set(semi.map(svg => svg.parentElement))
    const semiShapes = semi.map(svg => ({ id: svg.parentElement.dataset.shapeId, opacity: opacityOf(svg), bounds: boxOf(svg.getBoundingClientRect()) }))
    const opaqueNodes = [...nodes.filter(node => !semiNodes.has(node)), ...document.querySelectorAll('#status, #navigation')]
    const opaqueBoxes = opaqueNodes.map(node => boxOf(node.firstElementChild?.getBoundingClientRect() || node.getBoundingClientRect()))
    for (const node of opaqueNodes) for (const element of [node, ...node.querySelectorAll('*')]) {
      if (!(element instanceof HTMLElement)) continue
      opaqueBoxes.push(boxOf(element.getBoundingClientRect()))
      const paint = getComputedStyle(element)
      // Shadows and filters can paint outside layout boxes. Fail closed until
      // the probe supports their complete painted extent, rather than guessing.
      if ([paint.boxShadow, paint.textShadow, paint.filter].some(value => value && value !== 'none')) opaqueBoxes.push({ x: 0, y: 0, width: innerWidth, height: innerHeight })
    }
    const targets = [...new Set([...semiNodes, ...opaqueNodes])]
    if (targets.some(node => node.hasAttribute('data-clip-pixel-mask'))) throw new Error('裁剪掩码属性已被占用')
    const style = document.createElement('style')
    const transform = world.attributeStyleMap.get('transform')
    if (!transform?.toMatrix) throw new Error('裁剪像素检查需要CSS Typed OM保留相机精度')
    active = { world, transform, svgs, clips: svgs.map(svg => svg.style.clipPath), semiNodes, opaqueNodes, targets, style, probe, camera: window.__HICANVAS_RENDERER_PREVIEW__.getCamera() }
    return { viewport: { width: innerWidth, height: innerHeight }, geoCount: svgs.length, semiShapes, opaqueBoxes, probe: probe && { x: 20.5, y: innerHeight / 2 + 5.5, htmlY: innerHeight / 2 - 13.5, id: 'shape:clip-mask-semi-probe' } }
  } catch (error) { probe?.remove(); throw error }
}

export function setClipPixelMode({ clipped, maskId, color = 'black' }) {
  if (!active) throw new Error('裁剪像素检查尚未开始')
  if (!['black', 'white'].includes(color)) throw new Error('掩码只接受黑白颜色对照')
  const { world, svgs, clips, opaqueNodes, targets, style, camera: { x, y, z } } = active
  world.style.transform = `scale(${z}) translate3d(${x}px, ${y}px, 0)`
  svgs.forEach((svg, i) => { svg.style.clipPath = clipped ? clips[i] : '' })
  for (const node of targets) node.toggleAttribute('data-clip-pixel-mask', maskId === 'opaque' ? opaqueNodes.includes(node) : maskId !== undefined && node.dataset.shapeId === maskId)
  // Only paint colors change. Keep visibility, opacity, geometry and backgrounds
  // intact so the original translucent compositing and antialiasing stay active.
  style.textContent = `[data-clip-pixel-mask] svg [fill]:not([fill="none"]) { fill: ${color} !important }\n[data-clip-pixel-mask] svg [stroke]:not([stroke="none"]) { stroke: ${color} !important }`
  if (maskId !== undefined) document.head.append(style)
  else style.remove()
}

export function endClipPixelProbe() {
  if (!active) return
  const state = active
  active = undefined
  state.style.remove()
  state.probe?.remove()
  for (const node of state.targets) node.removeAttribute('data-clip-pixel-mask')
  state.world.attributeStyleMap.set('transform', state.transform)
  state.svgs.forEach((svg, i) => { svg.style.clipPath = state.clips[i] })
  return JSON.stringify(Array.from(state.world.attributeStyleMap.get('transform').toMatrix().toFloat64Array())) === JSON.stringify(Array.from(state.transform.toMatrix().toFloat64Array())) && state.svgs.every((svg, i) => svg.style.clipPath === state.clips[i]) && state.targets.every(node => !node.hasAttribute('data-clip-pixel-mask')) && !state.style.isConnected
}
