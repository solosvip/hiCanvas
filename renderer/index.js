// Framework-neutral mount: mountCanvasRenderer(element, {store,camera?,pageId?,loadGeneratedFrame?})
// returns setCamera/getCamera, hitTest, setOverlays and unmount. setOverlays takes
// [{kind:'selection'|'marquee', id?:string, bounds:{x,y,w,h}}] in canvas units.
// Overlay descriptions and camera are copied; mounting/drawing never edits Store.
export { canvasToScreen, screenToCanvas, hitTestCanvas } from './geometry.js'
export { mountCanvasRenderer } from './mount.js'
export { prepareCanvasFonts } from './fonts/prepare.js'
export { canvasFontStyle } from './font-families.js'
export { loadGeneratedFrame } from './content-host.js'
export { mountCanvasMinimap } from './minimap.js'
