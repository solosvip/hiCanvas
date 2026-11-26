import { createCanvasStore } from '../../model/index.js'
import { toRichText } from '@tldraw/tlschema'
import { executeCanvasCommands } from '../../engine/index.js'
import { mountCanvasRenderer, prepareCanvasFonts } from '../../renderer/index.js'
import { canvasFontFaces, canvasFontFamily } from '../../renderer/fonts/manifest.js'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

export async function runFontProbe() {
  await prepareCanvasFonts(document)
  const loaded = [...document.fonts].filter(face => face.family.includes('hiCanvas'))
  check(loaded.length === 16 && loaded.every(face => face.status === 'loaded'), '本地字体未全部准备好')
  const fixture = await (await fetch('/__renderer_fixture?count=500')).json()
  const records = Object.values(fixture.snapshot.store)
  const empty = { ...fixture.snapshot, store: Object.fromEntries(records.filter(record => record.typeName !== 'shape' && record.typeName !== 'asset').map(record => [record.id, record])) }
  const commands = []
  for (const [row, font] of ['draw', 'sans', 'serif', 'mono'].entries()) {
    for (const shapeType of ['text', 'arrow']) commands.push({ type: 'create_shape', id: `shape:font-${font}-${shapeType}`, shapeType, x: shapeType === 'text' ? 20 : 360, y: 50 + row * 100,
      props: { font, richText: toRichText('AV ffi 中文 日本語 한글'), ...(shapeType === 'text' ? { w: 280, autoSize: false } : { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } }) } })
  }
  const store = createCanvasStore()
  store.loadStoreSnapshot(executeCanvasCommands(empty, commands).snapshot)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;width:720px;height:500px'
  document.body.append(host)
  const renderer = mountCanvasRenderer(host, { store }), widths = {}
  try {
    await settle()
    const context = document.createElement('canvas').getContext('2d')
    for (const font of ['draw', 'sans', 'serif', 'mono']) {
      const family = canvasFontFamily(font)
      const text = host.querySelector(`[data-shape-id="shape:font-${font}-text"] [style*="font-family"]`)
      const arrow = host.querySelector(`[data-shape-id="shape:font-${font}-arrow"] [data-connection-label]`)
      check(getComputedStyle(text).fontFamily === family && getComputedStyle(arrow).fontFamily === family, `${font}文字/箭头未使用本地字体`)
      context.font = `20px ${family}`
      widths[font] = context.measureText('AV ffi').width
    }
    check(new Set(Object.values(widths)).size === 4, '四套字体未呈现各自的实际字形宽度')
    // Preparation is idempotent across mounts and camera changes. Width/layout
    // remain the deliberately unchanged estimates until #103 measurement.
    renderer.setCamera({ x: 10, y: 20, z: 2 }); await settle()
    await prepareCanvasFonts(document)
    check([...document.fonts].filter(face => face.family.includes('hiCanvas')).length === canvasFontFaces.length, '换视角重复登记字体')
    return { localFaces: loaded.length, fourTextFamilies: true, fourArrowFamilies: true, widths, preparationIsShared: true }
  } finally { renderer.unmount(); host.remove() }
}
