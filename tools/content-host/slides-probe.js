import {exportCowartSlides} from '../../src/editor/exports.jsx'
import {COWART_OPEN_SLIDES_EVENT} from '../../src/editor/configuration.jsx'
import {getAiSlidesItems} from '../../src/editor/slidesLayout.jsx'
// Only the system fullscreen output is denied in the fixture: the production
// presentation fallback stays mounted, without taking the user's foreground.
Element.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic offscreen window','NotAllowedError'))
let slidesId
window.slidesProbe={
  setup(id){slidesId=id;const editor=window.__cowartEditor;editor.select(id);editor.setCamera({x:0,y:0,z:1});editor.getContainerDocument().dispatchEvent(new CustomEvent(COWART_OPEN_SLIDES_EVENT,{detail:{slidesShapeId:id}}))},
  get iframe(){return document.querySelector('.cowart-slides-present-media iframe')||document.querySelector('.cowart-slides-current-media iframe')},
  state(){const frame=this.iframe;return{presenting:!!document.querySelector('.cowart-slides-viewer.is-presenting'),count:document.querySelector('.cowart-slides-present-controls span')?.textContent,src:frame?.src,srcdoc:frame?.hasAttribute('srcdoc'),buttons:[...document.querySelectorAll('.cowart-slides-viewer button')].map(el=>({text:el.textContent,label:el.getAttribute('aria-label')}))}},
  async export(){return exportCowartSlides(window.__cowartEditor,slidesId,'html')},
  async exportFailure(){
    const editor=window.__cowartEditor,shape=getAiSlidesItems(editor,slidesId)[1]
    editor.updateShape({id:shape.id,type:shape.type,props:{url:'data:text/html,'+encodeURIComponent('<img src="'+location.origin+'/c/'+new URLSearchParams(location.search).get('conversation')+'/assets/missing-export-image.png">')}})
    try{await exportCowartSlides(editor,slidesId,'html');return {failed:false}}catch(error){return {failed:true,error:error.message}}finally{editor.updateShape(shape)}
  },
}
