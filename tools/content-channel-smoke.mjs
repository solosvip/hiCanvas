import './test-sandbox.mjs'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile,cp,rm,access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath as fromUrl} from 'node:url'
import {build} from 'esbuild'
import {createHiCanvasService} from '../server/local-service.mjs'
import {createConversations} from '../server/conversations.mjs'

const root=fromUrl(new URL('../',import.meta.url)),output=join(root,'.scratch/content-channel-smoke')
const port=Number(process.env.HICANVAS_CHANNEL_PORT)
if(!Number.isInteger(port)||port<43300||port>65535)throw new Error('请先在白板登记专用端口，再指定HICANVAS_CHANNEL_PORT（43300以上）。')
await mkdir(output,{recursive:true})
const runtime=await mkdtemp(join(output,'runtime-')),distDir=join(runtime,'dist')
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#22283a;color:white;font:32px system-ui;padding:32px}strong{color:#76d5c7}</style><h1>本机合成影片</h1><p>MessagePort · <strong id="time">0.00</strong></p><script>
let anchor=0,clock=performance.now();
const film=window.CowartFilm={duration:3,currentTime:0,playing:false,muted:false,
getState(){if(this.playing)this.currentTime=Math.min(3,anchor+(performance.now()-clock)/1000);document.querySelector('#time').textContent=this.currentTime.toFixed(2);return this},
seek(t){this.currentTime=t;anchor=t;clock=performance.now();this.getState()},
play(){anchor=this.currentTime;clock=performance.now();this.playing=true},pause(){this.getState();this.playing=false},setMuted(value){this.muted=value}};
</script>`
let service
const messageHtml=html.replace(/<script>[\s\S]*<\/script>/,`<script>
let time=0,playing=false,muted=false,anchor=0,clock=performance.now();
function status(){if(playing)time=Math.min(3,anchor+(performance.now()-clock)/1000);document.querySelector('#time').textContent=time.toFixed(2);parent.postMessage({channel:'cowart-film',type:'status',duration:3,currentTime:time,playing,muted},'*')}
addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!=='cowart-film'||event.data.type!=='command')return;const {command,value}=event.data;
if(command==='seek'){time=value;anchor=time;clock=performance.now()}if(command==='play'){anchor=time;clock=performance.now();playing=true}if(command==='pause'){if(playing)time=Math.min(3,anchor+(performance.now()-clock)/1000);playing=false}if(command==='mute')muted=value;status()});
setInterval(()=>{if(playing)status()},100);status();
</script>`)
try{
  await cp(join(root,'dist'),distDir,{recursive:true})
  await build({absWorkingDir:root,entryPoints:['tools/content-host/channel-probe.js'],bundle:true,format:'esm',outfile:join(distDir,'channel-probe.js'),logLevel:'silent'})
  await writeFile(join(distDir,'channel-probe.html'),'<meta charset="utf-8"><title>实例通道合成预览</title><style>#canvas{height:240px;width:1100px}button,input{margin:8px}#status{font:16px monospace}</style><div id="canvas"></div><button id="play" disabled>播放</button><button id="pause" disabled>暂停</button><button id="mute" disabled>静音</button><input type="range" min="0" max="3" step="any" disabled><pre id="status"></pre><script type="module" src="/channel-probe.js"></script>')
  const executable=process.env.HICANVAS_TEST_ELECTRON||join(root,'node_modules/electron/dist',(await readFile(join(root,'node_modules/electron/path.txt'),'utf8')).trim())
  await access(executable,constants.X_OK)
  for(const variant of ['api','message']){
    const content=variant==='message'?messageHtml:html,key='isolated-'+variant
    const canvasDir=join(runtime,key,'canvas'),workspace=createConversations(canvasDir)
    const conversation=await workspace.open({createNew:true,title:'实例通道原生验证'}),current=await workspace.read(conversation.id)
    const pageId=Object.values(current.snapshot.store).find(record=>record.typeName==='page').id
    const record={id:'shape:channel-film',typeName:'shape',type:'embed',parentId:pageId,index:'a1',x:0,y:0,rotation:0,opacity:1,isLocked:false,props:{w:640,h:360,url:'data:text/html,'+encodeURIComponent(content)},meta:{cowartHtmlDraft:true,cowartFilm:true,cowartFilmDuration:3}}
    await workspace.submitCommands(conversation.id,current.revision,'channel-smoke',()=>[{type:'put',record}])
    await workspace.sidecar(conversation.id,'view',{currentPageId:pageId,camera:{x:150,y:100,z:1}})
    service=createHiCanvasService({distDir,canvasDir,settingsDir:join(runtime,key,'settings')})
    await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(port,'127.0.0.1',resolve)})
    const url='http://127.0.0.1:'+port,health=await(await fetch(url+'/api/health')).json()
    const result=join(output,key+'.json'),manifest=join(runtime,'manifest.json')
    await writeFile(manifest,JSON.stringify({url,output,result,profile:join(runtime,'profile-'+key),contentChannelOnly:true,contentSecurityOnly:true,contentPort:health.contentHost.port,scriptUrl:url,conversationId:conversation.id,html:content,variant}))
    await new Promise((resolve,reject)=>{
      const child=spawn(executable,[join(root,'tools/renderer-preview/electron.mjs'),manifest],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:'inherit'})
      const timer=setTimeout(()=>{child.kill();reject(new Error('实例通道原生冒烟超时'))},60000)
      child.once('error',error=>{clearTimeout(timer);reject(error)})
      child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('实例通道原生冒烟失败：'+result))})
    })
    service.closeAllConnections();await new Promise(resolve=>service.close(resolve));service=null
  }
  console.log('实例通道真实旧工具栏与新渲染宿主通过；证据：'+output)
}finally{
  if(service){service.closeAllConnections();await new Promise(resolve=>service.close(resolve))}
  await rm(runtime,{recursive:true,force:true})
}
