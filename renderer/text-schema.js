import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Code from '@tiptap/extension-code'

// Independently configured from public TipTap 3 schema / extend-extension docs.
// Keep the complete MIT StarterKit schema, including non-toolbar nodes. Schema
// preservation is #132; formatting UI, shortcuts and precise layout are #150.
export function canvasTextExtensions(content) {
  const attributes = new Map()
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type && node.attrs) {
      if (!attributes.has(node.type)) attributes.set(node.type, new Set())
      for (const key of Object.keys(node.attrs)) attributes.get(node.type).add(key)
    }
    node.content?.forEach(visit); node.marks?.forEach(visit)
  }
  visit(content)
  // Unknown attributes survive JSON editing but never become arbitrary DOM
  // attributes. Known extension attributes (link href, list start, etc.) keep
  // their public extension's existing parse/render behavior.
  const retained = Extension.create({
    name: 'canvasRetainedAttributes',
    addGlobalAttributes() {
      return [...attributes].map(([type, keys]) => ({ types: [type], attributes: Object.fromEntries([...keys].map(key => [key, { default: null, rendered: false }])) }))
    },
  })
  const direction = Extension.create({ name: 'canvasTextDirection', addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: { dir: { default: null, renderHTML: attrs => attrs.dir ? { dir: attrs.dir } : {} } } }]
  } })
  // The observed old editor retains Code together with bold/highlight. Its
  // existing records must remain valid here; dedicated mark behavior is #150.
  return [StarterKit.configure({ code: false, trailingNode: false, link: { openOnClick: false } }), Code.extend({ excludes: '' }), Highlight.configure({ multicolor: true }), retained, direction]
}
