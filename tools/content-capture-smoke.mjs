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
const allSamples=['first','repeat','plain','plain-repeat','failed','timeout','cross-origin','script-font']
const requested=process.argv.slice(2),samples=requested.length?requested:allSamples
if(samples.some(sample=>!allSamples.includes(sample)))throw new Error('截图样本无效')
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
  for(const key of samples){
    service=createHiCanvasService({distDir,canvasDir:join(runtime,key,'canvas'),settingsDir:join(runtime,key,'settings')})
    await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(port,'127.0.0.1',resolve)})
    const url='http://127.0.0.1:'+port,health=await(await fetch(url+'/api/health')).json()
    const result=join(output,key+'.json'),manifest=join(runtime,'manifest.json')
    await rm(result,{force:true})
    await writeFile(manifest,JSON.stringify({url,output,result,fontMode:key==='plain-repeat'?'plain':['first','repeat'].includes(key)?'font':key,profile:join(runtime,'profile-'+key),contentCaptureOnly:true,contentSecurityOnly:true,sample:key,contentPort:health.contentHost.port,scriptUrl:url,captureFont}))
    await runElectron(executable,[join(root,'tools/content-host/capture-electron.mjs'),manifest])
    service.closeAllConnections();await new Promise(resolve=>service.close(resolve));service=null
  }
  // Electron supplies the PNG decoder; no extra image tools or downloads.
  if(!requested.length)await runElectron(executable,[join(root,'tools/content-host/capture-pixels.cjs'),output],30000)
  console.log('四截图入口及重复像素一致性通过；证据：'+output)
}finally{
  if(service){service.closeAllConnections();await new Promise(resolve=>service.close(resolve))}
  await rm(runtime,{recursive:true,force:true})
}
