import {nativeImage} from 'electron'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

const keys=['png','copy','annotation','page-01.png','page-02.png']
// Native compositor and html2canvas use different antialiasing. Compare the
// heading's ink mask, allowing only a 2 output-pixel edge neighborhood. Interior
// glyph shape must match completely; the pre-fix font differs by about 30%.
export const fontTolerance={inkChannelDelta:32,edgeRadius:2,maxDistantInkRatio:0}
function ink(image,rect,{annotation=false}={}){
  const size=image.getSize(),pixels=image.toBitmap(),points=[]
  if(annotation&&(size.width!==608||size.height!==848))throw new Error('标注合成尺寸改变')
  if(!annotation&&(size.width!==640||size.height!==360))throw new Error('字体样本须使用2倍像素')
  for(let y=Math.ceil(rect.y*2);y<Math.floor((rect.y+rect.height)*2);y++)for(let x=Math.ceil(rect.x*2);x<Math.floor((rect.x+rect.width)*2);x++){
    // Fixture rotates the 320x180 page by 90deg and adds 32px padding.
    // Invert the published annotation bitmap, independently of product code.
    const px=annotation?463-y:x,py=annotation?104+x:y,index=(py*size.width+px)*4
    if(Math.abs(pixels[index]-84)<32&&Math.abs(pixels[index+1]-54)<32&&Math.abs(pixels[index+2]-38)<32)points.push([x,y])
  }
  if(points.length<500)throw new Error('字体样本没有足够真实文字像素')
  const minX=Math.min(...points.map(point=>point[0])),minY=Math.min(...points.map(point=>point[1]))
  return new Set(points.map(([x,y])=>(x-minX)+','+(y-minY)))
}
export function compareFontInk(capture,live,rect,options){
  const a=ink(capture,rect,options),b=ink(live,rect),radius=fontTolerance.edgeRadius
  let distant=0
  for(const [left,right]of [[a,b],[b,a]])for(const point of left){
    const [x,y]=point.split(',').map(Number);let found=false
    for(let dy=-radius;dy<=radius&&!found;dy++)for(let dx=-radius;dx<=radius;dx++)if(right.has((x+dx)+','+(y+dy))){found=true;break}
    if(!found)distant++
  }
  const result={captureInk:a.size,liveInk:b.size,distant,ratio:distant/(a.size+b.size)}
  if(result.ratio>fontTolerance.maxDistantInkRatio)throw new Error('截图字形与实际页面不同：'+JSON.stringify(result))
  return result
}
export async function captureFontOracle(window,manifest){
  const contents=window.webContents,frames=contents.mainFrame.frames
  const boxes=await contents.executeJavaScript('Array.from(document.querySelectorAll("#frames > iframe"),element=>{const r=element.getBoundingClientRect();return{x:Math.round(r.x+element.clientLeft),y:Math.round(r.y+element.clientTop),width:320,height:180}})')
  const samples=[]
  for(const [index,frame]of frames.entries()){
    const rect=await frame.executeJavaScript('(()=>{const r=document.querySelector("h1").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()')
    const image=await contents.capturePage(boxes[index])
    await writeFile(join(manifest.output,manifest.sample+'-live-'+index+'.png'),image.toPNG())
    samples.push({rect,image})
  }
  return async artifacts=>{
    const comparisons=[]
    for(const key of keys){
      const index=key==='page-01.png'?1:key==='page-02.png'?2:0,sample=samples[index]
      comparisons.push({key,...compareFontInk(nativeImage.createFromDataURL(artifacts[key]),sample.image,sample.rect,{annotation:key==='annotation'})})
    }
    return{tolerance:fontTolerance,comparisons}
  }
}
