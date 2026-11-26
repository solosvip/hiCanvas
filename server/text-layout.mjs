import { readFileSync } from 'node:fs'
import { canvasFontFaces } from '../renderer/fonts/manifest.js'
import { prepareTextLayout } from '../renderer/geometry.js'

let prepared = false
// Explicit host boundary: shared geometry never reads a file or chooses a font.
export function prepareNodeTextLayout() {
  if (prepared) return
  const files = new Map()
  prepareTextLayout(canvasFontFaces.map(face => {
    const name = face.url.pathname.split('/files/').at(-1)
    if (!files.has(name)) files.set(name, new Uint8Array(readFileSync(new URL(`../renderer/fonts/files/${name}`, import.meta.url))))
    return { ...face, bytes: files.get(name) }
  }))
  prepared = true
}
