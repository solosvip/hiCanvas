import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function captureSmoke(window,manifest){
  const contents=window.webContents,evaluate=code=>contents.executeJavaScript(code)
  const until=async predicate=>{const end=Date.now()+35000;while(Date.now()<end){const result=await predicate();if(result)return result;await delay(20)}throw new Error('截图回归等待超时')}
  await window.loadURL(manifest.url+'/tools/content-host/capture.html')
  await until(()=>evaluate('typeof window.startCapturePreview==="function"'))
  await evaluate(`window.startCapturePreview(${JSON.stringify({enabled:manifest.securityEnabled,font:manifest.captureFont})})`)
  // Dynamic fixture controls need a committed hit-test frame before native input.
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await contents.capturePage()
  await delay(100)
  const clicks=[]
  for(const key of ['png','copy','annotation','slides','delegation','limits','repeat']){
    const point=await evaluate(`(()=>{const element=document.querySelector('#${key}');element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    contents.sendInputEvent({type:'mouseMove',...point})
    for(const type of ['mouseDown','mouseUp'])contents.sendInputEvent({type,...point,button:'left',clickCount:1})
    try{await until(async()=>{
      const state=await evaluate('({done:window.__captureSmoke.completed,error:window.__captureSmoke.error})')
      if(state.error)throw new Error(state.error)
      return state.done.includes(key)
    })}catch(error){throw new Error(key+' '+error.message+' '+JSON.stringify(await evaluate('({done:window.__captureSmoke.completed,running:window.__captureSmoke.running,error:window.__captureSmoke.error,artifacts:Object.keys(window.__captureSmoke.artifacts)})')))}
    clicks.push(key)
  }
  const state=await evaluate('({checks:window.__captureSmoke.checks,artifacts:window.__captureSmoke.artifacts})')
  // Native test observation only, using Electron's documented WebFrameMain API.
  // Product code still cannot read cross-origin child DOM. This independently
  // verifies that equal PNGs did not merely fall back to the same missing font.
  const resources=await Promise.all(contents.mainFrame.frames.map(frame=>frame.executeJavaScript(`({font:document.fonts.check(getComputedStyle(document.querySelector('h1')).font),family:getComputedStyle(document.querySelector('h1')).fontFamily,image:document.querySelector('#raster').naturalWidth,iframes:document.querySelectorAll('iframe').length})`)))
  if(resources.length!==3||resources.some(value=>!value.font||value.image!==80||!/(CaptureFixture|system-ui)/.test(value.family)||value.iframes!==0))throw new Error('字体或延迟图片没有实际就绪：'+JSON.stringify(resources))
  state.checks.push({name:'独立子框架观察证明字体和延迟图片实际就绪，连续10次截图无残留iframe',pass:true})
  for(const key of ['png','copy','annotation','page-01.png','page-02.png',...manifest.securityEnabled?['browserCopy']:[]]){
    const url=state.artifacts[key]
    if(!url?.startsWith('data:image/png;base64,'))throw new Error('没有得到PNG：'+key)
    await writeFile(join(manifest.output,(manifest.securityEnabled?'on-':'off-')+key.replace('.png','')+'.png'),Buffer.from(url.split(',')[1],'base64'))
  }
  await writeFile(join(manifest.output,(manifest.securityEnabled?'on':'off')+'-window.png'),(await contents.capturePage()).toPNG())
  await evaluate('window.__captureSmoke.dispose()')
  return{checks:state.checks,resources,clicks,artifactKeys:Object.keys(state.artifacts)}
}
