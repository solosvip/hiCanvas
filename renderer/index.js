// Framework-neutral mount: mountCanvasRenderer(element, {store,camera?,pageId?,loadGeneratedFrame?,reduceMotion?})
// returns setCamera/getCamera, hitTest, setOverlays, setReduceMotion and unmount.
// setOverlays takes selection/marquee/crop descriptions in canvas units.
// Overlay descriptions and camera are copied; mounting/drawing never edits Store.
export { canvasToScreen, screenToCanvas, hitTestCanvas } from './geometry.js'
export { mountCanvasRenderer } from './mount.js'
export { prepareCanvasFonts } from './fonts/prepare.js'
export { canvasFontStyle } from './font-families.js'
export { loadGeneratedFrame } from './content-host.js'
export { mountCanvasMinimap } from './minimap.js'
