// Read-only evidence. Native input owns all editing; this probe can inspect
// the document and decode bytes already produced by the public capture action.
import {getContentChannel} from '../../content-channel/index.js'

export function installAnnotationProbe({host,session,interaction,transport,output}) {
  // Same readiness as export-probe: a mounted generated embed must have bound
  // its content channel before capture, or export-media rightly refuses it.
  const mediaReady=()=>session.store.allRecords().filter(r=>r.typeName==='shape'&&r.type==='embed').every(shape=>{
    const iframe=[...host.querySelectorAll('iframe[data-embed-content]')].find(node=>node.dataset.embedContent===shape.id)
    return iframe&&!!getContentChannel(iframe)
  })
  const api=Object.freeze({
    mediaReady,
    read:()=>({document:structuredClone(session.store.getStoreSnapshot('document')),state:structuredClone(interaction.state.get()),commits:transport.getCommitCount(),output:output.inspect(),active:host.ownerDocument.activeElement?.matches('[data-annotation-cancel]')?'cancel':host.ownerDocument.activeElement?.tagName}),
    async pixels(points=[],regions=[]){
      const result=output.getResult();if(!result)throw new Error('尚无完整标注截图。')
      const doc=host.ownerDocument,image=await createImageBitmap(new Blob([result.bytes],{type:result.mime})),canvas=doc.createElement('canvas')
      try{
        canvas.width=image.width;canvas.height=image.height
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0)
        const rgba=points.map(([x,y])=>[...context.getImageData(Math.floor((x-result.bounds.x)*result.scale),Math.floor((y-result.bounds.y)*result.scale),1,1).data])
        const ink=regions.map(box=>{
          const x=Math.max(0,Math.floor((box.x-result.bounds.x)*result.scale)),y=Math.max(0,Math.floor((box.y-result.bounds.y)*result.scale))
          const w=Math.min(image.width-x,Math.ceil(box.w*result.scale)),h=Math.min(image.height-y,Math.ceil(box.h*result.scale))
          const data=w>0&&h>0?context.getImageData(x,y,w,h).data:[],counts={red:0,dark:0}
          for(let i=0;i<data.length;i+=4){const [r,g,b,a]=data.slice(i,i+4);if(a>200&&r>120&&r>g*1.4&&r>b*1.4)counts.red++;if(a>200&&Math.max(r,g,b)<120)counts.dark++}
          return counts
        })
        return {width:image.width,height:image.height,rgba,regions:ink,bytes:result.bytes.length}
      }finally{image.close();canvas.width=canvas.height=0}
    },
  })
  Object.defineProperty(globalThis,'__HICANVAS_ANNOTATION_PROBE__',{value:api,configurable:true})
  return ()=>{delete globalThis.__HICANVAS_ANNOTATION_PROBE__}
}
