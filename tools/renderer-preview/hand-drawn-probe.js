import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { getHandDrawnContour } from '../../renderer/geometry.js'
import { createHandDrawnGallery } from './hand-drawn-gallery.js'

const check = (value, label) => { if (!value) throw new Error(label) }
const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

async function pixels(svg) {
  const copy = svg.cloneNode(true), canvas = document.createElement('canvas')
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('viewBox', '-20 -20 200 140')
  copy.setAttribute('width', '400'); copy.setAttribute('height', '280')
  canvas.width = 400; canvas.height = 280
  const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = source; await image.decode()
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, canvas.width, canvas.height).data
  } finally { URL.revokeObjectURL(source) }
}

function rowExtent(data, row) {
  let first = 400, last = -1
  for (let x = 0; x < 400; x++) if (data[(row * 400 + x) * 4 + 3] > 8) { first = Math.min(first, x); last = x }
  return { first, last }
}

export async function runHandDrawnProbe() {
  const fixture = createHandDrawnGallery('draw'), stores = [], hosts = [], renderers = []
  const target = (host, id) => host.querySelector(`[data-shape-id="${id}"] svg`)
  try {
    for (let i = 0; i < 3; i++) {
      const store = createCanvasStore(), snapshot = structuredClone(fixture.snapshot)
      if (i === 2) for (const record of Object.values(snapshot.store)) if (record.type === 'geo') record.props.fill = 'solid'
      store.loadStoreSnapshot(snapshot); stores.push(store)
      const host = document.createElement('div'); hosts.push(host); document.body.append(host)
      renderers.push(mountCanvasRenderer(host, { store, pageId: fixture.viewState.currentPageId }))
    }
    await settled()
    let matchedPixels = 0, boundaryRows = 0
    for (const record of Object.values(fixture.snapshot.store).filter(r => r.type === 'geo')) {
      const [first, reopened, filled] = hosts.map(host => target(host, record.id))
      const geometry = getHandDrawnContour(record), ink = first.querySelector('[data-geo-hand-ink]')
      const images = await Promise.all([first, reopened, filled].map(pixels))
      check(images[0].some((value, i) => i % 4 === 3 && value > 0), `${record.id} 笔触全透明`)
      check(images[0].every((value, i) => value === images[1][i]), `${record.id} 同一记录重新挂载后像素跳动`)
      check(ink?.getAttribute('d') === geometry.strokePath, `${record.id} 没有绘制独立笔触`)
      check(first.querySelector('[data-geo-outline]').getAttribute('d') === geometry.fillPath, `${record.id} 填充未沿手绘边界`)
      check(images[2].some((value, i) => i % 4 === 3 && value > 240 && images[0][i] === 0), `${record.id} 没有画出内部填充`)
      matchedPixels += images[0].length / 4
      for (let row = 0; row < 280; row++) {
        const inkExtent = rowExtent(images[0], row), filledExtent = rowExtent(images[2], row)
        check(filledExtent.last === -1 || inkExtent.last !== -1 && filledExtent.first >= inkExtent.first - 1 && filledExtent.last <= inkExtent.last + 1, `${record.id} 第${row}行填充越过手绘笔触`)
        boundaryRows++
      }
      const before = ink.getAttribute('d')
      renderers[0].setCamera({ x: 123, y: -49, z: .43 }); await settled()
      check(target(hosts[0], record.id).querySelector('[data-geo-hand-ink]').getAttribute('d') === before, `${record.id} 相机变化重抽笔触`)
      const current = stores[0].get(record.id)
      stores[0].put([{ ...current, x: current.x + 13, y: current.y - 8, props: { ...current.props, color: 'red' } }]); await settled()
      check(target(hosts[0], record.id).querySelector('[data-geo-hand-ink]').getAttribute('d') === before, `${record.id} 平移或换色重抽笔触`)
    }
    const small = stores[0].get('shape:hand-ellipse-xl'), context = document.createElement('canvas').getContext('2d')
    let smallCenterlines = 0
    for (const geo of ['rectangle', 'ellipse', 'star', 'triangle']) for (const [w, height] of [[.2, .125], [1, .625], [5, 3.125], [160, .2]]) {
      const record = { ...small, props: { ...small.props, geo, w, h: height, fill: 'none' } }
      stores[0].put([record]); await settled()
      const ink = target(hosts[0], record.id).querySelector('[data-geo-hand-ink]')
      const actualPath = new Path2D(ink.getAttribute('d'))
      for (const p of getHandDrawnContour(record).outline) {
        check(context.isPointInPath(actualPath, p.x, p.y, ink.getAttribute('fill-rule')), `${geo}/${w} 小形状笔触中心出现透明孔`)
        smallCenterlines++
      }
    }
    return { shapes: 16, smallCenterlines, exactRemountPixels: matchedPixels, filledBoundaryRows: boundaryRows, cameraAndStyleStable: true }
  } finally { renderers.forEach(renderer => renderer.unmount()); hosts.forEach(host => host.remove()) }
}
