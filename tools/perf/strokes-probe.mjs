// These observation functions execute in the page. They never synthesize input.
export async function waitUntilReady(fixture){
  const deadline=performance.now()+60000
  while(performance.now()<deadline){
    const editor=window.__cowartEditor,hook=window.__HICANVAS_STROKE_PREVIEW__
    const state=hook?.getState(fixture.targetId)
    if(state?.error||state?.lastError)throw new Error(state.error||state.lastError)
    const count=editor?.getCurrentPageShapeIds().size??state?.renderedShapes
    if(count===fixture.count&&(editor||state?.ready)){
      await document.fonts.ready
      const images=[...document.querySelectorAll(editor?'.tl-image':'#canvas img')]
      if(images.length===fixture.counts.image&&images.every(image=>image.complete&&image.naturalWidth>0)){
        await Promise.all(images.map(image=>image.decode()))
        if(editor)await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
        const camera=editor?{...editor.getCamera()}:hook.getCamera()
        const point=editor?editor.pageToScreen(fixture.targetPoint):{x:(fixture.targetPoint.x+camera.x)*camera.z,y:(fixture.targetPoint.y+camera.y)*camera.z}
        return {camera,point,documentShapes:count,renderedImages:images.length,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},nodes:document.querySelectorAll('*').length,paths:document.querySelectorAll('path').length}
      }
    }
    await new Promise(resolve=>setTimeout(resolve,25))
  }
  throw new Error('笔迹数量、字体、图片或交互未在60秒内就绪。')
}
export function inspectState(fixture){
  const editor=window.__cowartEditor,hook=window.__HICANVAS_STROKE_PREVIEW__
  const state=hook?.getState(fixture.targetId),shape=editor?editor.getShape(fixture.targetId):state.shape
  const camera=editor?{...editor.getCamera()}:state.camera,selectedIds=editor?editor.getSelectedShapeIds():state.selectedIds
  if(state?.lastError)throw new Error(state.lastError)
  return {camera,snapping:editor?Boolean(editor.user.getUserPreferences().isSnapMode):Boolean(state.snappingPreferences?.enabled),shape:{x:shape.x,y:shape.y,rotation:shape.rotation,props:shape.props},selectedIds,selected:selectedIds.includes(fixture.targetId),point:editor?editor.pageToScreen(fixture.targetPoint):{x:(fixture.targetPoint.x+camera.x)*camera.z,y:(fixture.targetPoint.y+camera.y)*camera.z}}
}
export async function resetCamera({camera}){
  if(window.__cowartEditor){window.__cowartEditor.setCamera(camera,{immediate:true,force:true})}
  else await window.__HICANVAS_STROKE_PREVIEW__.resetCamera(camera)
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
}
export function getCamera(){return window.__cowartEditor?{...window.__cowartEditor.getCamera()}:window.__HICANVAS_STROKE_PREVIEW__.getCamera()}
