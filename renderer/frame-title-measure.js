let node

// ADR0011 display-only exception, shared by the painted title and its editor.
// The caller adds its own inset; no DOM size enters saved shape geometry.
export function measureFrameTitle(text) {
  if (!node) {
    node = document.createElement('span')
    Object.assign(node.style, { position: 'fixed', visibility: 'hidden', contain: 'layout style paint', width: 'max-content', font: '12px system-ui', whiteSpace: 'pre', textSpacingTrim: 'space-all', textAutospace: 'no-autospace' })
  }
  node.textContent = text || 'Frame'
  document.body.append(node)
  try { return node.getBoundingClientRect().width + 12 }
  finally { node.remove() }
}
