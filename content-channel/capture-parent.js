import {getContentChannel} from './parent.js'

export async function renderContentCapture(iframe,options,requestOptions){
  const channel=getContentChannel(iframe)
  if(!channel)throw new Error('隔离网页截图通道尚未就绪，请稍后重试。')
  const result=await channel.request('capture',options,requestOptions)
  const buffer=result.pixels
  try{
    const canvas=iframe.ownerDocument.createElement('canvas')
    canvas.width=result.width;canvas.height=result.height
    const context=canvas.getContext('2d')
    if(!context)throw new Error('浏览器无法创建网页截图。')
    const ImageDataClass=iframe.ownerDocument.defaultView.ImageData
    context.putImageData(new ImageDataClass(new Uint8ClampedArray(buffer),result.width,result.height),0,0)
    return canvas
  }finally{
    // ImageData views the transferred bytes directly. Drop/detach them as soon
    // as putImageData has copied pixels into the caller-owned canvas.
    result.pixels=null
    buffer.transfer?.(0)
  }
}
