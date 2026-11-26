// The existing slide/annotation export budget: at most 4096 per edge and
// 16 million pixels (64 MB RGBA). Never silently crop or rescale over this cap.
export const MAX_CAPTURE_EDGE=4096
export const MAX_CAPTURE_PIXELS=16_000_000
// Assets already settle for 2 seconds; fonts, images and html2canvas can take
// longer than playback commands. Capture has a separate, bounded 30s deadline.
export const CAPTURE_TIMEOUT=30_000
const plain=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
export function captureSize(value){
  if(!exact(value,['width','height','pixelRatio'])||![value.width,value.height,value.pixelRatio].every(Number.isFinite)||value.width<=0||value.height<=0||value.pixelRatio<1)return null
  const width=Math.floor(value.width*value.pixelRatio),height=Math.floor(value.height*value.pixelRatio)
  return validDimensions(width,height)?{width,height}:null
}
export function validDimensions(width,height){
  return Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=MAX_CAPTURE_EDGE&&height<=MAX_CAPTURE_EDGE&&width*height<=MAX_CAPTURE_PIXELS
}
export function validPixels(value){
  return exact(value,['width','height','pixels'])&&validDimensions(value.width,value.height)&&value.pixels instanceof ArrayBuffer&&value.pixels.byteLength===value.width*value.height*4
}
