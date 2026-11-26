import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

// Synthetic only. Every supported legacy formatting node/mark is kept in a
// separate case to prove opening an editor never silently strips its schema.
export const formattedTextFixture = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 2, dir: 'rtl', retained: 'heading' }, content: [{ type: 'text', text: 'Formatted heading', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] }] },
    { type: 'paragraph', attrs: { dir: 'ltr', textAlign: 'center', retained: 'paragraph' }, content: [{ type: 'text', text: 'Code and marks', marks: [{ type: 'code' }, { type: 'bold' }, { type: 'highlight', attrs: { color: '#ffee00' } }, { type: 'strike' }] }, { type: 'hardBreak' }, { type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.invalid/', target: '_blank', rel: 'noopener', class: 'retained-link' } }] }] },
    { type: 'orderedList', attrs: { start: 4 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numbered item' }] }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet item' }] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }] },
    { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const retained = true' }] },
    { type: 'horizontalRule' },
  ],
}
export function createTextEditingFixture(formatted = false) {
  const commands = formatted ? [{ type: 'create_shape', id: 'shape:formatted', shapeType: 'text', x: 100, y: 180, props: { w: 900, autoSize: false, richText: formattedTextFixture } }] : [
    { type: 'create_shape', id: 'shape:text', shapeType: 'text', x: 100, y: 200, text: 'Alpha Beta' },
    { type: 'create_shape', id: 'shape:geo', shapeType: 'geo', x: 500, y: 150, text: 'Alpha Beta', props: { w: 250, h: 250 } },
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 100, y: 500, text: 'Arrow label', props: { end: { x: 400, y: 0 } } },
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 900, y: 200, props: { w: 300, h: 220, name: 'Board' } },
  ]
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
  const currentPageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id
  return { snapshot, textEditingFixture: true, count: commands.length, counts: {}, assetCount: 0, viewState: { currentPageId, camera: { x: 0, y: 0, z: 1 } } }
}
