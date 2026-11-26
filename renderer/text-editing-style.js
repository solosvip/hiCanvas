// Shared token-only editor stylesheet. Kept as data so Node can import the
// public renderer facade without a CSS loader or evaluating any DOM code.
export const textEditingStyle = `[data-canvas-text-editor] {
  position: absolute;
  transform-origin: top left;
  pointer-events: auto;
  user-select: text;
  color: inherit;
  background: transparent;
  border: var(--spacing-none);
  outline: none;
  padding: var(--spacing-none);
  margin: var(--spacing-none);
  min-width: var(--spacing-text-editor-min-width);
  white-space: pre-wrap;
  overflow-wrap: break-word;
  text-spacing-trim: space-all;
  text-autospace: no-autospace;
  box-sizing: border-box;
}
[data-canvas-text-editor] .tiptap { outline: none; min-width: inherit; }
[data-canvas-text-editor] p, [data-canvas-text-editor] h1, [data-canvas-text-editor] h2,
[data-canvas-text-editor] h3, [data-canvas-text-editor] h4,
[data-canvas-text-editor] h5, [data-canvas-text-editor] h6 {
  margin: var(--spacing-none);
  padding: var(--spacing-none);
}
[data-canvas-text-editor] strong { font-variation-settings: var(--canvas-text-bold-axes); }
[data-canvas-text-editor] em { font-variation-settings: var(--canvas-text-italic-axes); }
[data-canvas-text-editor] strong em, [data-canvas-text-editor] em strong { font-variation-settings: var(--canvas-text-bold-italic-axes); }
[data-shape-editing-text] > [data-shape-text],
[data-shape-editing-text] > [data-frame-title-root],
[data-shape-editing-text] > svg > [data-connection-label] { visibility: hidden; }
`
