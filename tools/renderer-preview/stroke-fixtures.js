import { b64Vecs, toRichText, DefaultColorStyle } from '@tldraw/tlschema'
import { getIndexAbove } from '@tldraw/utils'
import { createCanvasSnapshot } from '../../model/index.js'

const sizes = ['s', 'm', 'l', 'xl']
const dashes = ['draw', 'solid', 'dashed', 'dotted']
const line = [{ x: 0, y: 0, z: 0.5 }, { x: 170, y: 0, z: 0.5 }]
const wave = Array.from({ length: 49 }, (_, i) => ({ x: i * 3.5, y: Math.sin(i / 48 * Math.PI * 2) * 20, z: 0.5 }))
const loop = Array.from({ length: 65 }, (_, i) => ({ x: 65 + Math.cos(i / 64 * Math.PI * 2) * 60, y: 40 + Math.sin(i / 64 * Math.PI * 2) * 35, z: 0.5 }))
export const strokeSegment = (points, type = 'free') => ({ type, path: b64Vecs.encodePoints(points) })
export const strokeProps = (type = 'draw', overrides = {}) => ({
  color: type === 'draw' ? 'black' : 'yellow', size: 'm', segments: [strokeSegment(wave)], isComplete: true, isPen: false,
  scale: 1, scaleX: 1, scaleY: 1, ...(type === 'draw' ? { fill: 'none', dash: 'draw', isClosed: false } : {}), ...overrides
})

// Synthetic document coordinates; none of these dimensions are UI styles.
export function createStrokeGallery(mode) {
  if (!['stroke-styles', 'stroke-details', 'stroke-highlights', 'stroke-transforms'].includes(mode)) throw new Error('未知笔迹图鉴。')
  const snapshot = createCanvasSnapshot(), store = snapshot.store
  const pageId = Object.values(store).find(r => r.typeName === 'page').id
  let index = 'a0', serial = 0
  const counts = { geo: 0, text: 0, image: 0, draw: 0, highlight: 0 }
  const add = (type, x, y, props, opacity = 1) => {
    const id = `shape:stroke-${serial++}`
    store[id] = { id, typeName: 'shape', type, x, y, rotation: 0, index, parentId: pageId, isLocked: false, opacity, meta: {}, props }
    index = getIndexAbove(index); counts[type]++
    return id
  }
  const label = (text, x, y) => add('text', x, y, { richText: toRichText(text), color: 'black', size: 's', font: 'mono', scale: 1, w: 250, autoSize: false, textAlign: 'start' })
  const draw = (x, y, props) => add('draw', x, y, strokeProps('draw', props))
  if (mode === 'stroke-styles') {
    dashes.forEach((dash, row) => sizes.forEach((size, col) => {
      const x = 65 + col * 280, y = 100 + row * 180
      label(`${dash} / ${size}`, x, y - 50)
      draw(x, y, { dash, size, segments: [strokeSegment(line, 'straight')] })
      draw(x, y + 65, { dash, size })
    }))
  } else if (mode === 'stroke-details') {
    sizes.forEach((size, col) => {
      const x = 65 + col * 280
      label(`dot / ${size}`, x, 45)
      draw(x + 50, 115, { size, segments: [strokeSegment([{ x: 0, y: 0, z: 0.5 }])] })
      for (const [row, pressure] of [0.1, 0.5, 1].entries()) draw(x, 200 + row * 65, { size, isPen: true, segments: [strokeSegment(line.map(p => ({ ...p, z: pressure })))] })
      label('pressure 0.1 / 0.5 / 1', x, 390)
      draw(x, 470, { size, isPen: true, segments: [strokeSegment(wave.map((p, i) => ({ ...p, z: i / (wave.length - 1) })))] })
    })
    for (const [i, fill] of ['none', 'semi', 'solid', 'pattern', 'lined-fill', 'fill'].entries()) {
      const x = 35 + i * 195
      label(fill, x, 570)
      draw(x, 620, { color: 'blue', isClosed: true, fill, segments: [strokeSegment(loop)] })
    }
  } else if (mode === 'stroke-highlights') {
    sizes.forEach((size, col) => {
      const x = 65 + col * 280
      label(`highlight / ${size}`, x, 45)
      add('highlight', x, 130, strokeProps('highlight', { size, segments: [strokeSegment(line, 'straight')] }))
      add('highlight', x + 65, 240, strokeProps('highlight', { size, segments: [strokeSegment([{ x: 0, y: 0, z: 0.5 }])] }))
      add('highlight', x, 340, strokeProps('highlight', { size }))
      add('highlight', x, 460, strokeProps('highlight', { size, isPen: true, segments: [strokeSegment(wave.map((p, i) => ({ ...p, z: i / (wave.length - 1) })))] }))
      add('highlight', x, 600, strokeProps('highlight', { size: 'xl', color: 'yellow', segments: [strokeSegment(line, 'straight')] }))
      add('highlight', x + 65, 560, strokeProps('highlight', { size: 'xl', color: 'blue', segments: [strokeSegment([{ x: 0, y: 0, z: 0.5 }, { x: 0, y: 80, z: 0.5 }], 'straight')] }))
      label('叠色 / overlap', x, 690)
    })
  } else {
    DefaultColorStyle.values.forEach((color, i) => {
      const x = 55 + i % 4 * 290, y = 75 + Math.floor(i / 4) * 130
      label(color, x, y)
      add('highlight', x, y + 60, strokeProps('highlight', { color, size: 'm', segments: [strokeSegment(line, 'straight')] }))
    })
    for (const [i, transform] of [{ scale: 2 }, { scaleX: 2, scaleY: 0.5 }, { scaleX: -1, scaleY: 2 }].entries()) {
      label(JSON.stringify(transform), 55 + i * 390, 620)
      draw(55 + i * 390, 690, { dash: 'solid', ...transform, segments: [strokeSegment(line, 'straight')] })
    }
  }
  return { snapshot, viewState: { currentPageId: pageId, camera: { x: 20, y: 25, z: 0.93 } }, count: serial, counts, assetCount: 0 }
}

export function addStrokeLoad(fixture) {
  const snapshot = structuredClone(fixture.snapshot), records = Object.values(snapshot.store)
  const pageId = fixture.viewState.currentPageId
  let index = records.filter(r => r.typeName === 'shape').map(r => r.index).sort().at(-1)
  for (let i = 0; i < 500; i++) {
    const id = `shape:stroke-load-${i}`, type = i % 2 ? 'draw' : 'highlight'
    index = getIndexAbove(index)
    snapshot.store[id] = { id, typeName: 'shape', type, x: i % 23 * 128, y: Math.floor(i / 23) * 104, rotation: 0, index, parentId: pageId, isLocked: false, opacity: 1, meta: {},
      props: strokeProps(type, { size: sizes[i % 4], isPen: i % 3 === 0, segments: [strokeSegment(Array.from({ length: 129 }, (_, j) => ({ x: j * 0.75, y: 36 + Math.sin(j / 8) * 25, z: 0.2 + j / 160 })))] }) }
  }
  return { ...fixture, snapshot, count: fixture.count + 500, counts: { ...fixture.counts, draw: 250, highlight: 250 } }
}
