import {loadGeneratedFrame} from '../../renderer/index.js'
import {getContentChannel,renderContentCapture} from '../../content-channel/index.js'
import {cowartHtmlDraftIframes} from '../../src/editor/assets.jsx'
import {hasIsolatedHtmlCapture,renderCowartHtmlDraftCanvas} from '../../src/editor/htmlCapture.jsx'
import {exportCowartHtmlDraft,exportCowartSlides} from '../../src/editor/exports.jsx'
import {exportCowartHtmlDraftAnnotationScreenshot} from '../../src/editor/htmlAnnotations.jsx'
import {cowartUiOverrides} from '../../src/editor/overrides.jsx'

// Only the editor and output boundaries are fixtures. All four production
// entry functions, resource waiting, html2canvas, Ports and parent composition
// run unchanged. No real clipboard, file download, MCP or paid API is used.
window.startCapturePreview=async({font,enabled})=>{
  const checks=[],artifacts={},publications=[],toasts=[]
  const check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)}
  const bitmap=document.createElement('canvas');bitmap.width=80;bitmap.height=40
  const paint=bitmap.getContext('2d');paint.fillStyle='#f04733';paint.fillRect(0,0,40,40);paint.fillStyle='#279a73';paint.fillRect(40,0,40,40)
  const html=number=>`<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:CaptureFixture;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e9edf4}
  .clip{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:280px;height:140px;overflow:hidden;border-radius:16px;background:#24314c;border:4px solid #24314c}
  .inside{position:absolute;left:-12px;top:-7px;width:310px;height:160px;background:linear-gradient(35deg,#f9df9a,#cadff8)}
  h1{position:relative;margin:14px 20px 5px;font:700 23px ${number===3?'system-ui':'CaptureFixture,serif'};color:#263654}p{position:relative;margin:0 20px;font:italic 15px ${number===3?'system-ui':'CaptureFixture,serif'};color:#263654}img{position:absolute;width:80px;height:40px;right:18px;bottom:12px;transform:rotate(-7deg)}
  span{display:inline;vertical-align:baseline;padding:0 1px}
  </style><div class="clip"><div class="inside"></div><h1>Capture ${number} · Aa012</h1><p><span>Fonts, rounded crop &amp; transform</span></p><img id="raster"></div><script>setTimeout(()=>{document.querySelector('#raster').src=${JSON.stringify(bitmap.toDataURL())}},250)<\/script>`
  const web={id:'shape:web',type:'embed',x:100,y:70,props:{w:320,h:180},meta:{cowartHtmlDraft:true}}
  const slides={id:'shape:slides',type:'frame',props:{name:'合成幻灯片'},meta:{cowartAiSlides:true}}
  const pages=[1,2].map(number=>({id:'shape:slide-'+number,type:'embed',x:400*number,y:0,parentId:slides.id,props:{w:320,h:180},meta:{cowartHtmlDraft:true}}))
  const arrow={id:'shape:annotation',type:'arrow',meta:{cowartAnnotationArrow:true},props:{color:'red'}}
  const shapes=[web,slides,...pages,arrow],bounds={x:220,y:50,w:240,h:360}
  let selected=[web.id],delegated=0,bitmapWrites=0
  const editor={getShape:id=>shapes.find(shape=>shape.id===id),getSelectedShapeIds:()=>selected,getCurrentPageShapeIds:()=>new Set(shapes.map(shape=>shape.id)),getSortedChildIdsForParent:()=>pages.map(shape=>shape.id),
    getCurrentPageShapesSorted:()=>[web,arrow],getShapePageBounds:()=>bounds,getShapesPageBounds:()=>bounds,
    getShapePageTransform:()=>({a:0,b:1,c:-1,d:0,e:420,f:70}),
    async toImageDataUrl(ids,{bounds:area,pixelRatio=1}={}){
      check('标注叠加只交给父编辑器',ids.length===1&&ids[0]===arrow.id)
      const canvas=document.createElement('canvas');canvas.width=Math.round(area.w*pixelRatio);canvas.height=Math.round(area.h*pixelRatio)
      const ctx=canvas.getContext('2d');ctx.fillStyle='#d83e4f';ctx.fillRect(30*pixelRatio,35*pixelRatio,120*pixelRatio,8*pixelRatio)
      return{url:canvas.toDataURL()}
    },
  }
  const actions=cowartUiOverrides.actions(editor,{'copy-as-png':{onSelect(source){delegated++;return source}}},{addToast:toast=>toasts.push(toast)})
  const originalClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard')
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async write(items){
    bitmapWrites++;const blob=await items[0].getType('image/png')
    artifacts.browserCopy=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)})
  }}})
  const originalClick=HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click=function(){artifacts.png=this.href}
  async function widget(operation,key){
    window.openai={toolOutput:{canvasDir:'synthetic-no-disk'}}
    window.cowartMcp={async callServerTool({name,arguments:args}){
      if(!['download_cowart_file','copy_cowart_image_to_clipboard'].includes(name))throw new Error('禁止调用真实工具：'+name)
      artifacts[key==='slides'?args.fileName:key]=args.dataUrl
      return{structuredContent:{ok:true,width:640,height:360,directoryName:'synthetic'}}
    }}
    try{await operation()}finally{delete window.cowartMcp;delete window.openai}
  }
  for(const [index,shape] of [web,...pages].entries()){
    const iframe=document.createElement('iframe');iframe.width=320;iframe.height=180;iframe.title=shape.id
    const frame=await loadGeneratedFrame(html(index+1));publications.push(frame)
    const ready=new Promise((resolve,reject)=>{
      iframe.addEventListener('load',()=>{try{frame.bind?.(iframe);resolve()}catch(error){reject(error)}},{once:true})
    })
    cowartHtmlDraftIframes.set(shape.id,iframe)
    if(frame.attributes.src)iframe.src=frame.attributes.src;else iframe.srcdoc=frame.attributes.srcDoc
    check('加载前已识别隔离入口 '+shape.id,hasIsolatedHtmlCapture(shape)===enabled)
    if(enabled){
      let error;try{await renderCowartHtmlDraftCanvas(shape,2)}catch(value){error=value}
      check('握手前明确未就绪且不回退DOM '+shape.id,/通道尚未就绪/.test(error?.message))
    }
    document.querySelector('#frames').append(iframe);await ready
    check('iframe实际隔离状态 '+shape.id,enabled?!iframe.contentDocument:!!iframe.contentDocument)
  }
  const controls={
    png:()=>exportCowartHtmlDraft(editor,web.id,'png'),
    copy:()=>widget(()=>actions['copy-as-png'].onSelect('native-test'),'copy'),
    async annotation(){artifacts.annotation=(await exportCowartHtmlDraftAnnotationScreenshot(editor,web.id)).url},
    slides:()=>widget(()=>exportCowartSlides(editor,slides.id,'image'),'slides'),
    async delegation(){
      for(const ids of [[],[arrow.id],[web.id,arrow.id],...enabled?[]:[[web.id]]]){
        selected=ids;const count=delegated
        check('原样委托旧编辑器 '+JSON.stringify(ids),await actions['copy-as-png'].onSelect('same-source')==='same-source'&&delegated===count+1)
      }
      selected=[web.id]
      if(enabled){await actions['copy-as-png'].onSelect('isolated');check('隔离单网页在父页写PNG',bitmapWrites===1&&!!artifacts.browserCopy)}
      check('所有截图入口没有错误提示',!toasts.some(value=>value.severity==='error'))
    },
    async repeat(){
      if(!enabled)return
      const iframe=cowartHtmlDraftIframes.get(web.id)
      for(let i=0;i<10;i++){
        const canvas=await renderContentCapture(iframe,{width:320,height:180,pixelRatio:1})
        canvas.width=0;canvas.height=0
      }
    },
    async limits(){
      if(!enabled)return
      const iframe=cowartHtmlDraftIframes.get(web.id),channel=getContentChannel(iframe)
      let error;try{await channel.request('capture',{width:4097,height:1,pixelRatio:1})}catch(value){error=value}
      check('超限不缩小而明确报错',/4096/.test(error?.message))
      const abort=new AbortController(),first=channel.request('capture',{width:320,height:180,pixelRatio:2},{signal:abort.signal});abort.abort()
      await first.catch(value=>check('父页取消得到AbortError',value.name==='AbortError'))
      const fresh=await renderContentCapture(iframe,{width:320,height:180,pixelRatio:2})
      check('取消后下一张截图仍能成功',fresh.width===640&&fresh.height===360)
    },
  }
  for(const [key,run] of Object.entries(controls)){
    const button=document.createElement('button');button.id=key;button.textContent=key
    button.onclick=async()=>{window.__captureSmoke.running=key;try{await run();window.__captureSmoke.completed.push(key)}catch(error){window.__captureSmoke.error=error.stack}finally{window.__captureSmoke.running=null}}
    document.querySelector('#controls').append(button)
  }
  window.__captureSmoke={checks,artifacts,completed:[],error:null,running:null,async dispose(){
    HTMLAnchorElement.prototype.click=originalClick
    if(originalClipboard)Object.defineProperty(navigator,'clipboard',originalClipboard);else delete navigator.clipboard
    cowartHtmlDraftIframes.clear();await Promise.all(publications.map(frame=>frame.dispose()))
  }}
}
