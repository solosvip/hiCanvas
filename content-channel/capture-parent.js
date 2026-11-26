import {getContentChannel} from './parent.js'

async function capture(iframe,command,options,requestOptions){
  const channel=getContentChannel(iframe)
  if(!channel)throw new Error('隔离网页截图通道尚未就绪，请稍后重试。')
  const result=await channel.request(command,options,requestOptions)
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

export const renderContentCapture=(iframe,options,requestOptions)=>capture(iframe,'capture',options,requestOptions)
export const renderContentFilmFrame=(iframe,options,requestOptions)=>capture(iframe,'film-frame',options,requestOptions)
export async function renderContentFilmAudio(iframe,options,requestOptions){
  const channel=getContentChannel(iframe)
  if(!channel)throw new Error('隔离影片导出通道尚未就绪，请稍后重试。')
  const value=await channel.request('film-audio',options,requestOptions)
  const buffers=value.channels
  try{
    const audio=new iframe.ownerDocument.defaultView.AudioBuffer({sampleRate:value.sampleRate,numberOfChannels:value.numberOfChannels,length:value.length})
    buffers.forEach((buffer,index)=>audio.copyToChannel(new Float32Array(buffer),index))
    return audio
  }finally{
    value.channels=null
    for(const buffer of buffers)buffer.transfer?.(0)
  }
}
