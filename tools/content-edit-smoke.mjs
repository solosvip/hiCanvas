import './test-sandbox.mjs'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'vite'
import {createHiCanvasService} from '../server/local-service.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'.scratch/content-edit-smoke')
const port=Number(process.env.HICANVAS_EDIT_PORT)
if(!Number.isInteger(port)||port<43300||port>65535)throw new Error('先在白板登记专用端口，再指定HICANVAS_EDIT_PORT（43300以上）。')
await mkdir(output,{recursive:true})
const runtime=await mkdtemp(join(output,'runtime-')),distDir=join(runtime,'dist')
let service
async function electron(executable,manifest){
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,[join(root,'tools/content-host/edit-electron.mjs'),manifest],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:'inherit'})
    let expired=false,force
    const timeout=setTimeout(()=>{expired=true;child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),5000)},120000)
    child.once('error',error=>{clearTimeout(timeout);clearTimeout(force);reject(error)})
    child.once('close',code=>{clearTimeout(timeout);clearTimeout(force);expired?reject(new Error('就地编辑原生回归超时')):code?reject(new Error('就地编辑原生回归失败：'+output)):resolve()})
  })
}
try{
  await build({root,build:{outDir:distDir,rollupOptions:{input:join(root,'tools/content-host/edit.html')}},logLevel:'warn'})
  const executable=process.env.HICANVAS_TEST_ELECTRON||join(root,'node_modules/electron/dist',(await readFile(join(root,'node_modules/electron/path.txt'),'utf8')).trim())
  await access(executable,constants.X_OK)
  const reports=[]
  {
    const key='isolated',canvasDir=join(runtime,key,'canvas')
    service=createHiCanvasService({distDir,canvasDir,settingsDir:join(runtime,key,'settings')})
    await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(port,'127.0.0.1',resolve)})
    const url='http://127.0.0.1:'+port
    async function api(path,method='GET',body){const response=await fetch(url+path,{method,headers:{'x-hicanvas-client':'1','content-type':'application/json','connection':'close'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result}
    const {conversation}=await api('/api/conversations/open','POST',{createNew:true,title:'合成就地编辑回归'})
    const assets=join(canvasDir,'conversations',conversation.id,'assets');await mkdir(assets,{recursive:true})
    await writeFile(join(assets,'sample.css'),'#first{color:rgb(30,40,50)}')
    await writeFile(join(assets,'sample.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'))
    const source=`<!doctype html><html><head><meta charset="utf-8"><link rel="alternate" href="${url}/c/${conversation.id}/assets/sample.css"><style>body{margin:24px;font:20px Arial;background:white;color:black}p{margin:18px 0;line-height:30px}button{font:20px Arial}</style></head><body><p id="first">Alpha beta gamma</p><p id="second">one two three</p><button id="action" onclick="window.actionClicks=(window.actionClicks||0)+1">Action</button><p id="preexisting" contenteditable="true" spellcheck="true">Existing</p><img id="raster" src="/c/${conversation.id}/assets/sample.png" width="12" height="12"></body></html>`
    const before=await api('/api/canvas?conversation='+conversation.id)
    const inserted=await api('/api/canvas/html?conversation='+conversation.id,'POST',{expectedRevision:before.revision,htmlContent:source,displayWidth:600,displayHeight:400,x:100,y:100})
    const health=await api('/api/health'),manifest=join(runtime,'manifest.json'),result=join(output,key+'.json')
    await writeFile(manifest,JSON.stringify({url,output,result,profile:join(runtime,'profile-'+key),conversationId:conversation.id,shapeId:inserted.shapeId,source,contentPort:health.contentHost.port}))
    await electron(executable,manifest)
    reports.push(JSON.parse(await readFile(result,'utf8')))
    service.closeAllConnections();await new Promise(resolve=>service.close(resolve));service=null
  }
  await writeFile(join(output,'report.json'),JSON.stringify({reports},null,2)+'\n')
  console.log('隔离网页就地编辑回归通过；证据：'+output)
}finally{
  if(service){service.closeAllConnections();await new Promise(resolve=>service.close(resolve))}
  await rm(runtime,{recursive:true,force:true})
}
