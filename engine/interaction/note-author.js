// Host-supplied displayName is the only identity input. No account / OS /
// runtime actor lookup. Each editing host owns its document attribution ID.
// Native legacy observations: first inserted character (even spaces) assigns
// an author, creation / empty edit doesn't, deleting all content clears it.
const textPresent = node => node?.type === 'text' ? Boolean(node.text?.length) : (node?.content || []).some(textPresent)
export function createNoteAuthor(displayName) {
  if (displayName != null && typeof displayName !== 'string') throw new Error('便签显示名需要字符串。')
  const name = displayName?.trim() || '', id = `note-author-${globalThis.crypto.randomUUID()}`
  return { id, recordId: `user:${id}`, describe(shape, content, store) {
    if (!textPresent(content)) return { author: null, commands: [] }
    if (shape.props.textFirstEditedBy) return { author: shape.props.textFirstEditedBy, commands: [] }
    if (!name) return { author: null, commands: [] }
    return { author: id, commands: store.has(`user:${id}`) ? [] : [{ type: 'put', record: { id: `user:${id}`, typeName: 'user', name, color: 'black', imageUrl: '', meta: {} } }] }
  } }
}
