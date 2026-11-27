// Framework-neutral mount: mountCanvasRenderer(element, {store,camera?,pageId?,loadGeneratedFrame?,reduceMotion?})
// returns setCamera/getCamera, hitTest, setOverlays, setReduceMotion and unmount.
// setOverlays takes selection/marquee/crop/connection/snap-guides/grid descriptions
// in canvas units; guide points/ticks are rendered with constant CSS thickness.
// A grid has positive spacing in canvas units and paints below the shape world.
// An eraser has shape ids, 0..256 tail points and tailScale (0..1). Preview
// masks both shape passes without editing opacity records; point queries can
// opt into includeTransparent, retaining frame clipping and default visibility.
// Overlay descriptions and camera are copied; mounting/drawing never edits Store.
export { canvasToScreen, screenToCanvas, hitTestCanvas } from './geometry.js'
export { mountCanvasRenderer } from './mount.js'
export { prepareCanvasFonts } from './fonts/prepare.js'
export { canvasFontStyle } from './font-families.js'
export { loadGeneratedFrame } from './content-host.js'
export { mountCanvasMinimap } from './minimap.js'
export { measureFrameTitle } from './frame-title-measure.js'
export { preflightCanvasExport, renderCanvasExport, CANVAS_EXPORT_LIMITS } from './export.js'
