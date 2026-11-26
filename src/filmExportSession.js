import {COWART_FILM_EXPORT_PIXEL_RATIO} from './filmExportSize.js'
import {loadGeneratedFrame} from '../renderer/index.js'
import {renderContentFilmFrame,renderContentFilmAudio,waitForFilmTask} from '../content-channel/index.js'

// A disposable export instance; parent owns encoding, never reads child DOM,
// CowartFilm, audio graphs, media elements or the child's virtual clock.
export async function openFilmExportSession({html,width,height,duration,sourceUrl},options){
  const publication=await loadGeneratedFrame(html,{sourceUrl,signal:options.signal})
  if(!publication.bind)return null
  const iframe=document.createElement('iframe'),lifecycle=new AbortController()
  const signal=options.signal?AbortSignal.any([options.signal,lifecycle.signal]):lifecycle.signal
  const tasks={...options,signal,timeout:options.timeout||15000}
  let observer,disposed=false
  const fail=message=>lifecycle.abort(new Error(message))
  const reloaded=()=>fail('影片导出页已重新加载，请重新导出。')
  const check=()=>{signal.throwIfAborted();if(!iframe.isConnected)throw new Error('影片导出页已卸载。')}
  const dispose=async()=>{
    if(disposed)return
    disposed=true;iframe.removeEventListener('load',reloaded);observer?.disconnect()
    lifecycle.abort(new DOMException('影片导出已结束。','AbortError'))
    // Actual removal destroys any unabortable child render and releases its
    // existing #114 memory lease; revocation then drops published assets.
    iframe.remove();await publication.dispose()
  }
  iframe.setAttribute('sandbox','allow-scripts allow-same-origin');iframe.setAttribute('aria-hidden','true')
  iframe.style.cssText=`position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none;`
  try{
    await waitForFilmTask(()=>new Promise(resolve=>{
      iframe.addEventListener('load',resolve,{once:true})
      iframe.src=publication.attributes.src;document.body.append(iframe)
    }),{...tasks,label:'隔离影片加载'})
    check();publication.bind(iframe,{duration,muted:true,film:false})
    iframe.addEventListener('load',reloaded)
    observer=new MutationObserver(()=>{
      if(!iframe.isConnected)fail('影片导出页已卸载。')
      else if(iframe.src!==publication.attributes.src)fail('影片导出页已导航，请重新导出。')
    })
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcdoc']})
    return{options:tasks,check,dispose,
      async audio(){check();const result=await renderContentFilmAudio(iframe,{duration,taskTimeout:tasks.timeout},tasks);check();return result},
      async frame(index){
        check()
        const canvas=await renderContentFilmFrame(iframe,{index,width,height,pixelRatio:COWART_FILM_EXPORT_PIXEL_RATIO},tasks)
        try{check();return canvas}catch(error){canvas.width=canvas.height=0;throw error}
      },
    }
  }catch(error){await dispose();throw error}
}
