// Same UTF-8 ceiling as the existing HTML edit command in canvas-media.mjs.
export const MAX_EDIT_HTML_BYTES=5*1024*1024
const plain=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
export const editRevision=value=>Number.isSafeInteger(value)&&value>=0
export const editCommand=command=>['edit-start','edit-snapshot','edit-ack','edit-stop'].includes(command)
export const editStateCommand=command=>['edit-start','edit-ack','edit-stop'].includes(command)
export const largeResultCommand=command=>['capture','film-frame','film-audio','edit-snapshot'].includes(command)
export function releaseEditSnapshot(value){if(value&&typeof value==='object'&&Object.hasOwn(value,'html'))value.html=''}
export function cleanEditHtml(html,instance=''){
  if(typeof html!=='string'||!html.trim()||html.length>MAX_EDIT_HTML_BYTES||new TextEncoder().encode(html).byteLength>MAX_EDIT_HTML_BYTES)return false
  // Reject leftovers at the receiving boundary too: the child is untrusted.
  // This is a persistence invariant, not a script/content sanitizer.
  return !/(?:\.hicanvas-channel|data-(?:cowart-dom-editor|hicanvas-capture)-|cowart-dom-editor-style|[a-f0-9]{48}\.localhost|blob:|\0)/i.test(html)&&(!instance||!html.includes(instance))
}
export function validEditState(value){
  return exact(value,['revision','savedRevision','dirty'])&&editRevision(value.revision)&&editRevision(value.savedRevision)&&value.savedRevision<=value.revision&&value.dirty===(value.revision>value.savedRevision)
}
export function validEditSnapshot(value,instance){
  return exact(value,['revision','savedRevision','html'])&&editRevision(value.revision)&&editRevision(value.savedRevision)&&value.savedRevision<=value.revision&&cleanEditHtml(value.html,instance)
}
