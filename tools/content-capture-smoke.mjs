import './test-sandbox.mjs'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'vite'
import {createHiCanvasService} from '../server/local-service.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'.scratch/content-capture-smoke')
const port=Number(process.env.HICANVAS_CAPTURE_PORT)
if(!Number.isInteger(port)||port<43300||port>65535)throw new Error('先在白板登记专用端口，再指定HICANVAS_CAPTURE_PORT（43300以上）。')
await mkdir(output,{recursive:true})
const runtime=await mkdtemp(join(output,'runtime-')),distDir=join(runtime,'dist')
async function runElectron(executable,args,timeout=120000){
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:'inherit'})
    let expired=false,forceTimer
    const timer=setTimeout(()=>{
      expired=true;child.kill('SIGTERM')
      forceTimer=setTimeout(()=>child.kill('SIGKILL'),5000)
    },timeout)
    const cleanup=()=>{clearTimeout(timer);clearTimeout(forceTimer)}
    child.once('error',error=>{cleanup();reject(error)})
    // Wait for close even on timeout: the runtime directory must outlive all
    // process I/O and Chromium children. Both smoke and pixel decoder use this.
    child.once('close',code=>{cleanup();expired?reject(new Error('截图原生回归超时')):code===0?resolve():reject(new Error('截图原生回归失败（'+code+'）：'+output))})
  })
}
let service
try{
  await build({root,build:{outDir:distDir,rollupOptions:{input:join(root,'tools/content-host/capture.html')}},logLevel:'warn'})
  const executable=process.env.HICANVAS_TEST_ELECTRON||join(root,'node_modules/electron/dist',(await readFile(join(root,'node_modules/electron/path.txt'),'utf8')).trim())
  await access(executable,constants.X_OK)
  const captureFont=(await readFile(join(root,'renderer/fonts/files/ibm-plex-sans/IBMPlexSans-Bold.woff2'))).toString('base64')
  for(const enabled of [false,true]){
    const key=enabled?'on':'off'
    service=createHiCanvasService({distDir,canvasDir:join(runtime,key,'canvas'),settingsDir:join(runtime,key,'settings'),contentHostEnabled:enabled})
    await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(port,'127.0.0.1',resolve)})
    const url='http://127.0.0.1:'+port,health=await(await fetch(url+'/api/health')).json()
    const result=join(output,key+'.json'),manifest=join(runtime,'manifest.json')
    await writeFile(manifest,JSON.stringify({url,output,result,profile:join(runtime,'profile-'+key),contentCaptureOnly:true,contentSecurityOnly:true,securityEnabled:enabled,contentPort:health.contentHost.port,scriptUrl:url,captureFont}))
    await runElectron(executable,[join(root,'tools/renderer-preview/electron.mjs'),manifest])
    service.closeAllConnections();await new Promise(resolve=>service.close(resolve));service=null
  }
  // Pixel comparison runs in a fresh Electron process for its built-in PNG
  // decoder. No extra image tools or browser downloads are installed.
  const compare=join(runtime,'compare.cjs'),report=join(output,'pixels.json')
  await writeFile(compare,`const{app,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');app.setActivationPolicy?.('prohibited');const results=[];try{for(const key of ['png','copy','annotation','page-01','page-02']){const images=['off','on'].map(mode=>nativeImage.createFromPath(path.join(${JSON.stringify(output)},mode+'-'+key+'.png')));const size=images[0].getSize();if(JSON.stringify(size)!==JSON.stringify(images[1].getSize()))throw Error('尺寸改变 '+key);const a=images[0].toBitmap(),b=images[1].toBitmap();let changed=0,total=0,red=0,green=0;for(let i=0;i<a.length;i+=4){let max=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);total+=d;max=Math.max(max,d)}if(max>8)changed++;if(a[i+2]>180&&a[i+1]<120)red++;if(a[i+1]>100&&a[i+2]<80)green++}const ratio=changed/(a.length/4),mean=total/a.length;if(ratio>.01||mean>.5)throw Error('像素差异超限 '+key+' '+ratio+' '+mean);if(red<1000||green<1000)throw Error('素材未真实出现 '+key+' '+red+' '+green);results.push({key,...size,changedPixels:changed,ratio,mean,red,green})}fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({tolerance:{channelDelta:8,maxChangedRatio:.01,maxMeanAbsoluteDifference:.5},results},null,2));app.exit(0)}catch(error){console.error(error);app.exit(1)}`)
  await runElectron(executable,[compare],30000)
  console.log('四截图入口原生开关对照通过；证据：'+output)
}finally{
  if(service){service.closeAllConnections();await new Promise(resolve=>service.close(resolve))}
  await rm(runtime,{recursive:true,force:true})
}
