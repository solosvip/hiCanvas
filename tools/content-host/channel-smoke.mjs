import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

// Scenario on the existing pinned Electron driver, using native input.
export async function channelSmoke(window,manifest,createPreviewWindow){
  let contents=window.webContents
  const evaluate=code=>contents.executeJavaScript(code)
  const checks=[],check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)}
  const until=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){const value=await predicate();if(value)return value;await delay(20)}throw new Error('实例通道原生冒烟等待超时')}
  async function click(selector){
    const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();if(!e||e.disabled||!r.width)throw new Error('控件不可用：'+${JSON.stringify(selector)});return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    for(const type of ['mouseDown','mouseUp'])contents.sendInputEvent({type,...point,button:'left',clickCount:1})
  }
  await window.loadURL(manifest.url+'/?conversation='+manifest.conversationId)
  const play='button[aria-label="播放影片"]',pause='button[aria-label="暂停影片"]',mute='button[aria-label="静音影片"]',range='input[aria-label="影片进度"]'
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(play)})?.disabled===false`))
  const before=await evaluate("(()=>{const frame=document.querySelector('iframe[data-cowart-html-draft-shape-id]');return {url:frame.src,srcdoc:frame.hasAttribute('srcdoc'),blocked:!frame.contentDocument}})()")
  check('旧界面开启时确实跨来源，关闭时保留直接DOM',manifest.securityEnabled?before.blocked&&!before.srcdoc:!before.blocked&&before.srcdoc)
  await click(play)
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(range)}).valueAsNumber>.15`))
  await click(pause)
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(play)})?.disabled===false`))
  check('旧界面真实播放与暂停按钮更新状态',await evaluate(`document.querySelector(${JSON.stringify(play)})?.disabled===false`))
  const scrub=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(range)}).getBoundingClientRect();return{x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height/2)}})()`)
  for(const type of ['mouseDown','mouseUp'])contents.sendInputEvent({type,...scrub,button:'left',clickCount:1})
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(range)}).valueAsNumber>1.1`))
  check('旧界面原生定位仍暂停，时间显示同步',await evaluate(`!!document.querySelector(${JSON.stringify(play)})&&document.querySelector(${JSON.stringify(range)}).valueAsNumber<1.9`))
  await click(mute)
  await until(()=>evaluate('document.querySelector(\'button[aria-label="取消静音"]\')?.getAttribute("aria-pressed")==="true"'))
  await writeFile(join(manifest.output,'legacy-'+(manifest.securityEnabled?'on-':'off-')+manifest.variant+'.png'),(await contents.capturePage()).toPNG())
  if(manifest.securityEnabled){
    await until(()=>evaluate(`fetch('/api/canvas?conversation='+${JSON.stringify(manifest.conversationId)},{headers:{'x-hicanvas-client':'1'}}).then(r=>{if(!r.ok)throw new Error('合成画板读取失败：'+r.status);return r.json()}).then(result=>Object.values(result.snapshot.store).some(record=>record.meta?.cowartFilmMuted===true))`))
    check('静音经原有保存路径写回合成画板',true)
    // Keep the real editor alive: navigation would abort its unrelated pending
    // view/selection saves and produce a network error in this test harness.
    const preview=createPreviewWindow();contents=preview.webContents
    await preview.loadURL(manifest.url+'/channel-probe.html')
    await until(()=>evaluate('typeof window.startChannelPreview==="function"'))
    await evaluate(`window.startChannelPreview(${JSON.stringify(manifest.html)})`)
    await until(()=>evaluate('window.__channelSmoke?.getState().status?.ready===true&&window.__channelSmoke.getState().count===3'))
    check('同一新渲染页面三个挂载仅请求一次启动信息',await evaluate('window.__channelSmoke.getState().requests===1'))
    await click('#play')
    await until(()=>evaluate('window.__channelSmoke.getState().status.currentTime>.15'))
    await click('#pause')
    await until(()=>evaluate('window.__channelSmoke.getState().status.playing===false'))
    await click('#mute')
    await until(()=>evaluate('window.__channelSmoke.getState().status.muted===true'))
    const urls=await evaluate('window.__channelSmoke.getState().urls')
    const version=await evaluate('window.__channelSmoke.getState().loadVersion')
    await evaluate('window.__channelSmoke.reload()')
    await until(()=>evaluate(`window.__channelSmoke.getState().loadVersion>${version}&&window.__channelSmoke.getState().status?.ready===true`))
    await click('#play')
    await until(()=>evaluate('window.__channelSmoke.getState().status.playing===true'))
    check('新渲染页重载后新通道仍可播放',true)
    await click('#pause')
    await until(()=>evaluate('window.__channelSmoke.getState().status.playing===false'))
    await writeFile(join(manifest.output,'renderer-on-'+manifest.variant+'.png'),(await contents.capturePage()).toPNG())
    await evaluate('window.__channelSmoke.unmount()')
    preview.destroy()
    return {checks,oldUrl:before.url,urls}
  }
  return {checks,oldUrl:before.url}
}
