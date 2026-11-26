import { ArrowShapeArrowheadEndStyle, toRichText } from '@tldraw/tlschema'
import { getIndexAbove } from '@tldraw/utils'
import { createCanvasSnapshot } from '../../model/index.js'

// Shared synthetic records for old/new screenshot comparison. No editor APIs.
export function createConnectionGallery(mode = 'arrows', initial) {
  if (!['arrows', 'routes', 'lines', 'bindings', 'bound-elbows'].includes(mode)) throw new Error('未知连接线图鉴。')
  const snapshot = initial ? structuredClone(initial) : createCanvasSnapshot(), records = snapshot.store
  const pageId = Object.values(records).find(r => r.typeName === 'page').id
  let index = 'a0', serial = 0
  const counts = {}, cases = []
  const add = (id, type, x, y, props, extra = {}) => {
    records[id] = { id, typeName: 'shape', type, x, y, rotation: 0, index, parentId: pageId, isLocked: false, opacity: 1, meta: {}, props, ...extra }
    index = getIndexAbove(index); serial++; counts[type] = (counts[type] || 0) + 1
    return id
  }
  const label = (text, x, y) => add(`shape:connection-label-${serial}`, 'text', x, y, { richText: toRichText(text), color: 'black', size: 's', font: 'mono', scale: 1, w: 340, autoSize: false, textAlign: 'start' })
  const arrow = (id, x, y, props = {}, extra) => add(id, 'arrow', x, y, { kind: 'arc', start: { x: 0, y: 0 }, end: { x: 260, y: 0 }, bend: 0, color: 'black', labelColor: 'black', fill: 'none', dash: 'solid', size: 'm', arrowheadStart: 'none', arrowheadEnd: 'arrow', font: 'sans', richText: toRichText(''), labelPosition: .5, scale: 1, elbowMidPoint: .5, ...props }, extra)
  const geo = (id, x, y, props = {}, extra) => add(id, 'geo', x, y, { geo: 'rectangle', w: 140, h: 100, growY: 0, color: 'blue', labelColor: 'black', fill: 'none', dash: 'solid', size: 'm', scale: 1, richText: toRichText(''), font: 'sans', align: 'middle', verticalAlign: 'middle', url: '', ...props }, extra)
  if (mode === 'arrows') {
    ArrowShapeArrowheadEndStyle.values.forEach((head, i) => {
      const x = 70 + i % 3 * 380, y = 95 + Math.floor(i / 3) * 190
      arrow(`shape:head-${head}`, x, y, { arrowheadStart: head, arrowheadEnd: head })
      label(head, x, y + 36)
    })
    for (const [i, size] of ['s', 'm', 'l', 'xl'].entries()) {
      arrow(`shape:head-size-${size}`, 80 + i * 285, 700, { end: { x: 200, y: 0 }, size, arrowheadStart: 'triangle', arrowheadEnd: 'arrow' })
      label(size, 80 + i * 285, 740)
    }
  } else if (mode === 'routes') {
    const variants = [{ bend: 0 }, { bend: 55 }, { bend: -55 }, { bend: 180 }, { kind: 'elbow', end: { x: 260, y: 100 } }, { kind: 'elbow', end: { x: -200, y: 110 }, elbowMidPoint: .25 }]
    variants.forEach((props, i) => {
      const x = 80 + i % 3 * 380, y = 160 + Math.floor(i / 3) * 300
      arrow(`shape:route-${i}`, x + (i === 5 ? 220 : 0), y, { richText: toRichText('Arrow label'), ...props })
      label(`${props.kind || 'arc'} / bend ${props.bend || 0}`, x, y + 145)
    })
    for (const [i, font] of ['draw', 'sans', 'serif', 'mono'].entries()) {
      arrow(`shape:label-font-${font}`, 70 + i * 295, 780, { end: { x: 235, y: 0 }, font, richText: toRichText('Label 123'), labelPosition: i % 2 ? .7 : .3 })
      label(font, 70 + i * 295, 820)
    }
  } else if (mode === 'lines') {
    for (const [row, spline] of ['line', 'cubic'].entries()) for (const [col, points] of [
      [[0, 0], [260, 100]], [[0, 0], [100, 100], [260, 0]], [[0, 100], [70, 0], [160, 100], [260, 0]],
    ].entries()) {
      const x = 70 + col * 380, y = 100 + row * 320
      add(`shape:line-${row}-${col}`, 'line', x, y, { color: 'black', dash: 'solid', size: 'm', spline, scale: 1, points: Object.fromEntries(points.map(([x, y], i) => [`a${i + 1}`, { id: `a${i + 1}`, index: `a${i + 1}`, x, y }])) })
      label(`${spline} / ${points.length} points`, x, y + 150)
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const rowY = 60 + i * 190, targetId = `shape:target-${i}`, arrowId = `shape:bound-${i}`
      let extra = i === 2 ? { rotation: Math.PI / 6 } : undefined
      if (i === 3) {
        add('shape:binding-frame', 'frame', 450, rowY - 15, { w: 360, h: 150, name: 'Frame', color: 'black' }, { rotation: -.15 })
        extra = { parentId: 'shape:binding-frame' }
      }
      geo(targetId, i === 3 ? 50 : 500, i === 3 ? 25 : rowY, { geo: i === 1 ? 'ellipse' : 'rectangle' }, extra)
      arrow(arrowId, 60, rowY + 50, { end: { x: 510, y: 0 }, richText: toRichText(['rectangle', 'ellipse', 'rotation', 'in frame'][i]) })
      const id = `binding:connection-${i}`
      records[id] = { id, typeName: 'binding', type: 'arrow', fromId: arrowId, toId: targetId, meta: {}, props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: false, snap: 'none' } }
      if (mode === 'bound-elbows') {
        records[arrowId].props.kind = 'elbow'
        Object.assign(records[id].props, { isPrecise: true, normalizedAnchor: { x: .25, y: .1 }, snap: ['none', 'center', 'edge', 'edge-point'][i] })
      }
      cases.push({ arrowId, targetId })
    }
  }
  return { snapshot, count: serial, counts, cases, assetCount: 0, viewState: { currentPageId: pageId, camera: { x: 0, y: 0, z: mode === 'routes' ? .8 : .9 } } }
}
