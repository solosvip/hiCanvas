import { DefaultColorStyle, toRichText } from '@tldraw/tlschema'
import { getIndexAbove } from '@tldraw/utils'
import { createCanvasSnapshot } from '../../model/index.js'

export const noteProps = (overrides = {}) => ({ color: 'black', richText: toRichText(''), size: 'm', font: 'draw', align: 'middle', verticalAlign: 'middle', labelColor: 'black', growY: 0, fontSizeAdjustment: 1, url: '', scale: 1, textFirstEditedBy: null, ...overrides })

export function createNoteGallery(mode) {
  if (!['note-colors', 'note-text', 'note-layout', 'note-fonts', 'note-whitespace', 'frame-titles'].includes(mode)) throw new Error('未知便签图鉴。')
  const snapshot = createCanvasSnapshot(), store = snapshot.store
  const pageId = Object.values(store).find(r => r.typeName === 'page').id
  let serial = 0, index = 'a0'
  const counts = { note: 0, frame: 0, text: 0, geo: 0, image: 0 }
  const add = (type, x, y, props, extra = {}) => {
    const id = `shape:${mode}-${serial++}`
    store[id] = { id, typeName: 'shape', type, x, y, rotation: 0, index, parentId: pageId, isLocked: false, opacity: 1, meta: {}, props, ...extra }
    index = getIndexAbove(index); counts[type]++
  }
  if (mode === 'note-colors') DefaultColorStyle.values.forEach((color, i) => add('note', i % 5 * 240, Math.floor(i / 5) * 245, noteProps({ color, richText: toRichText(color) })))
  if (mode === 'note-text') ['s', 'm', 'l', 'xl'].forEach((size, row) => ['start', 'middle', 'end'].forEach((align, col) => add('note', col * 285, row * 245, noteProps({ size, align, richText: toRichText(`Abcd 中文\n${size} ${align}`) }))))
  if (mode === 'note-layout') {
    ['start', 'middle', 'end'].forEach((verticalAlign, row) => ['start', 'middle', 'end'].forEach((align, col) => add('note', col * 240, row * 240, noteProps({ align, verticalAlign, font: 'sans', richText: toRichText('One\nTwo') }))))
    add('note', 740, 0, noteProps({ richText: toRichText(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n')), font: 'sans' }))
    store['user:note-author'] = { id: 'user:note-author', typeName: 'user', name: 'Avery Longname', color: 'blue', imageUrl: '', meta: {} }
    add('note', 990, 0, noteProps({ richText: toRichText('Avery Longname'), textFirstEditedBy: 'note-author', font: 'sans' }))
    add('note', 990, 300, noteProps({ richText: toRichText('Scaled\n中文'), scale: 0.6, color: 'blue' }), { rotation: 0.15 })
    add('note', 990, 510, noteProps({ richText: toRichText(''), textFirstEditedBy: 'note-author', color: 'red' }))
    add('note', 990, 740, noteProps({ richText: toRichText('Label color'), labelColor: 'red', font: 'sans' }))
    add('note', 740, 520, noteProps({ richText: toRichText('Paragraph\n\n空行'), size: 's', color: 'green' }))
  }
  if (mode === 'note-fonts') ['draw', 'sans', 'serif', 'mono'].forEach((font, col) => add('note', col * 285, 0, noteProps({ font, align: 'start', verticalAlign: 'start', richText: toRichText(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?-/()中汉你好界').join(' ')) })))
  if (mode === 'note-whitespace') [`A${' '.repeat(50)}B`, 'A  B', 'A\tB', '   A   '].forEach((text, col) => add('note', col * 240, 0, noteProps({ font: 'mono', richText: toRichText(col === 0 ? Array(8).fill(text).join('\n') : text) })))
  if (mode === 'frame-titles') {
    const titles = ['Frame title', '中文画框名称', 'A very long frame title that should be truncated at its boundary', '', 'First\nSecond', 'A😀éZ', 'Long unbroken XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX']
    titles.forEach((name, i) => add('frame', i % 3 * 395, 60 + Math.floor(i / 3) * 240, { w: i === 2 ? 160 : i === 6 ? 40 : 280, h: 160, name, color: ['black', 'blue', 'red', 'green'][i % 4] }))
  }
  return { snapshot, count: serial, counts, assetCount: 0, viewState: { version: 1, currentPageId: pageId, camera: { x: 35, y: 40, z: mode === 'note-text' ? 0.85 : 1 } } }
}
