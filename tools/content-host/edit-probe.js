import {cowartHtmlDraftDomEditSessions} from '../../src/editor/assets.jsx'
import {getContentChannel} from '../../content-channel/index.js'

// Test-only controls around the actual mounted app. Product editing, selection,
// persistence, polling and save buttons run unchanged against the synthetic host.
const nativeFetch=window.fetch.bind(window)
let held=false,release,requests=[],shapeId
window.fetch=async(input,options)=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href)
  if(url.pathname==='/api/html-draft'&&options?.method==='PUT'){
    requests.push(JSON.parse(options.body))
    if(held){held=false;await new Promise(resolve=>{release=resolve})}
  }
  return nativeFetch(input,options)
}
window.editProbe={
  requests,
  setup(id){shapeId=id;window.__cowartEditor.select(id);window.__cowartEditor.setCamera({x:0,y:0,z:1})},
  get iframe(){return document.querySelector('iframe[data-cowart-html-draft-shape-id="'+shapeId+'"]')},
  get session(){return cowartHtmlDraftDomEditSessions.get(shapeId)},
  state(){const frame=this.iframe;return {editing:window.__cowartEditor?.getEditingShapeId(),session:!!this.session,src:frame?.getAttribute('src'),srcdoc:frame?.hasAttribute('srcdoc'),isolated:!!getContentChannel(frame),saving:!!release,requests:requests.length}},
  hold(){held=true},release(){const done=release;release=null;done?.()},
  flush(){window.__editFlush={pending:true};this.session.flush().then(()=>{window.__editFlush={done:true}},error=>{window.__editFlush={error:error.message}})},
  async persisted(){
    const board=new URLSearchParams(location.search).get('conversation')
    const state=await(await nativeFetch('/api/canvas?conversation='+board,{headers:{'x-hicanvas-client':'1'}})).json(),shape=state.snapshot.store[shapeId]
    const html=await(await nativeFetch(shape.meta.cowartHtmlDraftAssetUrl)).text()
    return{revision:state.revision,shape,html,schema:state.snapshot.schema}
  },
  async remoteMove(){
    const board=new URLSearchParams(location.search).get('conversation')
    const path='/api/canvas?conversation='+board
    const state=await(await nativeFetch(path,{headers:{'x-hicanvas-client':'1'}})).json()
    state.snapshot.store[shapeId].x+=20
    const result=await nativeFetch(path,{method:'PUT',headers:{'x-hicanvas-client':'1','content-type':'application/json'},body:JSON.stringify({snapshot:state.snapshot,expectedRevision:state.revision})})
    if(!result.ok)throw new Error('合成远端位置修改失败 '+result.status)
    return result.json()
  },
  async remote(html){
    const board=new URLSearchParams(location.search).get('conversation')
    const state=await(await nativeFetch('/api/canvas?conversation='+board,{headers:{'x-hicanvas-client':'1'}})).json()
    const path='/api/html-draft?conversation='+board
    const result=await nativeFetch(path,{method:'PUT',headers:{'x-hicanvas-client':'1','content-type':'application/json'},body:JSON.stringify({draftShapeId:shapeId,expectedRevision:state.revision,htmlContent:html})})
    if(!result.ok)throw new Error('合成远端写入失败 '+result.status)
    return result.json()
  },
}
