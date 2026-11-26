import '../renderer-preview/style.css'
import {react} from '@tldraw/state'
import {createEditorSession,createCanvasInteraction} from '../../engine/index.js'
import {mountCanvasRenderer,prepareCanvasFonts} from '../../renderer/index.js'
import {memoryTransport} from '../renderer-preview/transport.js'
import {attachPreviewInput} from '../renderer-preview/input.js'
import {handleCornerHitSize,handleEdgeHitSize,handleRotationOffset,handleRotationRadius} from '../../src/styles/tokens.js'

const host=document.querySelector('#canvas'),status=document.querySelector('#status'),disposers=[]
let fixture,session,interaction,renderer,controls,ready=false,error=null
const cleanup=()=>{for(const dispose of disposers.splice(0).reverse())dispose()}
const getState=targetId=>{
  const state=interaction?.state.get(),shape=session?.store.get(targetId)
  return {ready,error,count:fixture?.count,camera:state&&{...state.camera},snappingPreferences:state?.snappingPreferences,selectedIds:state?[...state.selectedIds]:[],shape:shape&&{x:shape.x,y:shape.y,rotation:shape.rotation,props:shape.props},renderedShapes:host.querySelectorAll('[data-shape-id]').length,images:[...host.querySelectorAll('img')].map(image=>({complete:image.complete,width:image.naturalWidth})),lastError:state?.lastError||session?.state.get().lastError}
}
window.__HICANVAS_STROKE_PREVIEW__={getState,getCamera:()=>({...interaction.state.get().camera}),resetCamera(camera){interaction.setCamera(camera)}}
try{
  await prepareCanvasFonts(document)
  const response=await fetch('/fixture?case='+encodeURIComponent(new URLSearchParams(location.search).get('case')))
  if(!response.ok)throw new Error('未知合成笔迹样本。')
  fixture=await response.json()
  session=await createEditorSession({transport:memoryTransport(fixture.snapshot),actor:'stroke-performance'})
  disposers.push(()=>session.dispose())
  interaction=createCanvasInteraction({session,snapping:{enabled:Boolean(fixture.snapping)},camera:fixture.viewState.camera,pageId:fixture.viewState.currentPageId,viewport:{w:host.clientWidth,h:host.clientHeight},inputDevice:null,handleMetrics:{cornerHit:handleCornerHitSize/2,edgeHit:handleEdgeHitSize/2,rotationOffset:handleRotationOffset,rotationRadius:handleRotationRadius}})
  disposers.push(()=>interaction.dispose())
  renderer=mountCanvasRenderer(host,{store:session.store,camera:fixture.viewState.camera,pageId:fixture.viewState.currentPageId})
  disposers.push(()=>renderer.unmount())
  disposers.push(react('stroke benchmark view',()=>{const state=interaction.state.get();renderer.setCamera(state.camera);renderer.setOverlays(state.overlays);controls?.wake()}))
  controls=attachPreviewInput(host,interaction,{onError:failure=>{error=failure.message}})
  disposers.push(()=>controls.dispose())
  await document.fonts.ready
  await Promise.all([...host.querySelectorAll('img')].map(image=>image.decode()))
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
  if(getState().renderedShapes!==fixture.count)throw new Error('笔迹渲染数量不符。')
  status.textContent=fixture.caseName;ready=true
  addEventListener('pagehide',cleanup,{once:true})
}catch(failure){error=failure.message;status.textContent=error;cleanup()}
