import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function filmSmoke(window,manifest){
  const contents=window.webContents,evaluate=code=>contents.executeJavaScript(code)
  const until=async predicate=>{const end=Date.now()+90000;while(Date.now()<end){const result=await predicate();if(result)return result;await delay(20)}throw new Error('影片原生回归等待超时')}
  await window.loadURL(manifest.url+'/tools/content-host/film.html')
  await until(()=>evaluate('typeof window.startFilmPreview==="function"'))
  await evaluate(`window.startFilmPreview(${JSON.stringify({font:manifest.captureFont})})`)
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await contents.capturePage();await delay(100)
  const clicks=[]
  for(const key of ['render','slow','audio','failures','customTimeout','phaseFailures','legacy']){
    const point=await evaluate(`(()=>{const r=document.querySelector('#${key}').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    contents.sendInputEvent({type:'mouseMove',...point})
    for(const type of ['mouseDown','mouseUp'])contents.sendInputEvent({type,...point,button:'left',clickCount:1})
    await until(async()=>{const state=await evaluate('({done:window.__filmSmoke.completed,error:window.__filmSmoke.error,elapsed:window.__filmSmoke.artifacts.elapsed,slow:window.__filmSmoke.artifacts.slow,slowAudio:window.__filmSmoke.artifacts.slowAudio})');if(state.error)throw new Error(key+' '+state.error+' '+JSON.stringify(state));return state.done.includes(key)})
    clicks.push(key)
  }
  const state=await evaluate('({checks:window.__filmSmoke.checks,artifacts:window.__filmSmoke.artifacts})'),key=manifest.sample
  for(const [index,frame]of state.artifacts.frames.entries())await writeFile(join(manifest.output,key+'-frame-'+index+'.png'),Buffer.from(frame.png.split(',')[1],'base64'))
  for(const [index,channel]of state.artifacts.pcm.entries())await writeFile(join(manifest.output,key+'-pcm-'+index+'.f32'),Buffer.from(channel,'base64'))
  for(const [index,channel]of state.artifacts.legacy.pcm.entries())await writeFile(join(manifest.output,key+'-legacy-pcm-'+index+'.f32'),Buffer.from(channel,'base64'))
  state.artifacts.legacy={bytes:state.artifacts.legacy.bytes}
  await writeFile(join(manifest.output,key+'.mp4'),Buffer.from(state.artifacts.mp4.split(',')[1],'base64'))
  const {mp4,pcm,frames,...artifacts}=state.artifacts
  await evaluate('window.__filmSmoke.dispose()')
  return{checks:state.checks,artifacts,frames:frames.map(({time})=>time),clicks}
}
