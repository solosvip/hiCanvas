import { createCanvasAnnotationCapture } from '../../engine/index.js'
import { preflightCanvasExport, renderCanvasExport } from '../../renderer/index.js'

// Synthetic host only: bytes remain in memory. No download, model or clipboard.
export function attachAnnotationUi(toolbar, host, session, interaction, targetId, onError) {
  const doc = host.ownerDocument, listeners = [], history = []
  let result = null, renders = 0, disposed = false
  const capture = createCanvasAnnotationCapture({session,interaction,preflight:preflightCanvasExport,render:(snapshot,options)=>{renders++;return renderCanvasExport(snapshot,{...options,document:doc,host})}})
  const button = doc.createElement('button');button.type='button';button.textContent='汇集标注截图';button.dataset.annotationCapture=''
  const cancel = doc.createElement('button');cancel.type='button';cancel.textContent='取消截图';cancel.dataset.annotationCancel=''
  const status = doc.createElement('output');status.dataset.annotationStatus='';status.setAttribute('role','status')
  const listen=(node,type,handler)=>{node.addEventListener(type,handler);listeners.push(()=>node.removeEventListener(type,handler))}
  listen(button,'click',async()=>{
    button.disabled=true;status.textContent='正在生成标注截图…';result=null
    try{
      const value=await capture.run({targetId,origin:'toolbar'})
      if(disposed)return
      if(value.status==='complete'){
        result=value
        const row={targetId:value.targetId,ids:[...value.ids],width:value.width,height:value.height,bounds:value.bounds,scale:value.scale,bytes:value.bytes.length,warnings:value.warnings,blockedResources:value.blockedResources,failedResources:value.failedResources}
        history.push(row);if(history.length>20)history.shift()
        status.textContent=[`标注截图 ${value.width}×${value.height}，${value.ids.length} 个对象`,...(value.warnings||[])].join('；')
      }else status.textContent=value.message||`截图未完成：${value.reason||value.status}`
    }catch(error){status.textContent=`标注截图失败：${error.message}`;onError(error)}
    finally{button.disabled=disposed}
  })
  listen(cancel,'click',()=>capture.cancel())
  toolbar.append(button,cancel,status)
  return {inspect:()=>({...capture.state.get(),renders,history:structuredClone(history),message:status.textContent}),getResult:()=>result,
    dispose(){disposed=true;capture.dispose();for(const stop of listeners)stop();button.remove();cancel.remove();status.remove();result=null},
  }
}
