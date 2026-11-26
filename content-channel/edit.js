import {createCowartHtmlDraftDomEditorSession,serializeCowartHtmlDraftDocument,COWART_DOM_EDITOR_HOVER_ATTRIBUTE,COWART_DOM_EDITOR_SELECTED_ATTRIBUTE,COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE,COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE} from './dom-editor.js'
import {MAX_EDIT_HTML_BYTES,cleanEditHtml} from './edit-protocol.js'

// All DOM parsing stays in this instance's realm. Never ask the parent to parse
// returned HTML: resource-loading side effects must keep the child's authority.
function restoreResources(original,root,parentOrigin){
  const normalize=text=>{
    for(const origin of ['http://cowart.local','https://cowart.local',parentOrigin])for(const prefix of ['/c/','/assets/','/page-assets/'])text=text.replaceAll(origin+prefix,prefix)
    return text
  }
  const byId=new Map([...root.querySelectorAll('[id]')].map(element=>[element.id,element]))
  const walk=(before,after)=>{
    if(!after||before.tagName!==after.tagName)return
    for(const attribute of before.attributes)if(after.getAttribute(attribute.name)===normalize(attribute.value))after.setAttribute(attribute.name,attribute.value)
    if(['SCRIPT','STYLE'].includes(before.tagName)&&after.textContent===normalize(before.textContent))after.textContent=before.textContent
    for(let i=0;i<before.children.length;i++){
      const child=before.children[i]
      walk(child,child.id?byId.get(child.id):after.children[i])
    }
  }
  walk(original.documentElement,root)
}
export async function createContentEditController(host,{instanceId,parentOrigin,onChange,onRequestExit,signal}){
  const response=await host.fetch('/.hicanvas-channel/'+instanceId+'/edit-source.txt',{mode:'same-origin',credentials:'omit',redirect:'error',signal})
  if(!response.ok)throw new Error('无法读取网页编辑原文。')
  const source=await response.text()
  signal.throwIfAborted()
  if(source.length>MAX_EDIT_HTML_BYTES||new TextEncoder().encode(source).length>MAX_EDIT_HTML_BYTES)throw new Error('网页编辑原文超过5 MiB。')
  const original=new host.DOMParser().parseFromString(source,'text/html')
  let editor=null,offeredRevision=null
  function serialize(document){
    const html=serializeCowartHtmlDraftDocument(document,root=>{
      // Only the known injected bridge is removed. Other forbidden runtime
      // remnants fail validation rather than silently becoming saved content.
      for(const script of root.querySelectorAll('script[src]')){
        let url
        try{url=new URL(script.getAttribute('src'),host.location.href)}catch{continue}
        if(url.origin===host.location.origin&&url.pathname==='/.hicanvas-channel/'+instanceId+'/bootstrap.js')script.remove()
      }
      for(const attribute of [COWART_DOM_EDITOR_HOVER_ATTRIBUTE,COWART_DOM_EDITOR_SELECTED_ATTRIBUTE,COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE,COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE])root.removeAttribute(attribute)
      restoreResources(original,root,parentOrigin)
    })
    if(!cleanEditHtml(html,instanceId))throw new Error('网页保存内容超过5 MiB或包含运行时残留。')
    return html
  }
  const state=()=>editor?.getState()||{revision:0,savedRevision:0,dirty:false}
  return {
    command(command,value){
      if(command==='edit-start'){
        editor ||= createCowartHtmlDraftDomEditorSession(host.document,{onChange,onRequestExit,serialize,protectUnsaved:true})
        return state()
      }
      if(!editor)throw new Error('网页编辑尚未开始。')
      if(command==='edit-snapshot'){
        const snapshot=editor.snapshot();offeredRevision=snapshot.revision;return snapshot
      }
      if(command==='edit-ack'){
        if(value!==offeredRevision)throw new Error('只能确认已取回的网页版本。')
        return editor.acknowledge(value)
      }
      if(command==='edit-stop'){
        const current=state()
        if(!current.dirty||value===false){editor.dispose({save:false});editor=null;offeredRevision=null}
        return current
      }
      throw new Error('网页编辑命令无效。')
    },
    dispose(){editor?.dispose({save:false});editor=null;offeredRevision=null},
  }
}
