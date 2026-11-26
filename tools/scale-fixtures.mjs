import { b64Vecs, toRichText } from '@tldraw/tlschema'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'

export const subject = 'shape:subject'
export function fixture(type, props = {}, { group = false, nested = false, peer = false } = {}) {
  const initial = createCanvasSnapshot(), page = Object.values(initial.store).find(r => r.typeName === 'page').id
  const defaults = {
    line: {},
    note: { color: 'yellow', labelColor: 'black', size: 'm', font: 'sans', fontSizeAdjustment: null, align: 'middle', verticalAlign: 'middle', url: '', textFirstEditedBy: null, richText: toRichText('Note'), scale: 1, growY: 0 },
    bookmark: { w: 300, h: 155, url: '', assetId: null },
    video: { w: 320, h: 180, url: '', assetId: null, time: 0, playing: false, autoplay: false, altText: '' },
    draw: { color: 'black', fill: 'none', dash: 'solid', size: 'm', isClosed: false },
    highlight: { color: 'yellow', size: 'm' },
  }
  const stroke = ['draw', 'highlight'].includes(type) ? { segments: [{ type: 'free', path: b64Vecs.encodePoints([{ x: 0, y: 0, z: .2 }, { x: 200, y: 100, z: .8 }]) }], isComplete: true, isPen: true, scale: 1, scaleX: 1, scaleY: 1 } : {}
  const record = (id, kind, parentId, x, y, value, index = 'a1') => ({ id, typeName: 'shape', type: kind, parentId, x, y, props: value, index, rotation: 0, opacity: 1, isLocked: false, meta: {} })
  const commands = []
  if (group) commands.push({ type: 'put', record: record('shape:group', 'group', page, nested ? 100 : 300, nested ? 100 : 250, {}) })
  if (nested) commands.push({ type: 'put', record: record('shape:inner', 'group', 'shape:group', 200, 150, {}) })
  const parentId = nested ? 'shape:inner' : group ? 'shape:group' : page
  commands.push(defaults[type] ? { type: 'put', record: record(subject, type, parentId, group ? 0 : 300, group ? 0 : 250, { ...defaults[type], ...stroke, ...props }) }
    : { type: 'create_shape', id: subject, shapeType: type, parentId, x: group ? 0 : 300, y: group ? 0 : 250, props })
  if (group || peer) commands.push({ type: 'create_shape', id: 'shape:peer', shapeType: 'geo', parentId, x: group ? 460 : 760, y: group ? 0 : 250, props: { w: 100, h: 100, fill: 'solid' } })
  if (nested) commands.push({ type: 'create_shape', id: 'shape:outer-peer', shapeType: 'geo', parentId: 'shape:group', x: 900, y: 150, props: { w: 100, h: 100, fill: 'solid' } })
  return executeCanvasCommands(initial, commands).snapshot
}
export function scale(snapshot, factors, options = {}) {
  return executeCanvasCommands(snapshot, [{ type: 'scale_shapes', ids: [subject], origin: { x: 300, y: 250 }, scale: factors, ...options }])
}
export function near(actual, expected) { if (Math.abs(actual - expected) > 1e-7) throw new Error(`${actual} != ${expected}`) }
