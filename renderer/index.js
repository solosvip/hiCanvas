// Framework-neutral mount: mountCanvasRenderer(element, {store,camera?,pageId?})
// returns setCamera/getCamera, hitTest, setOverlays and unmount. setOverlays takes
// [{kind:'selection'|'marquee', id?:string, bounds:{x,y,w,h}}] in canvas units.
// Overlay descriptions and camera are copied; mounting/drawing never edits Store.
export { canvasToScreen, screenToCanvas, hitTestCanvas } from './geometry.js'
export { mountCanvasRenderer } from './mount.js'
