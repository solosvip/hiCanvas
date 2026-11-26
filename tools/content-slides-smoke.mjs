import './test-sandbox.mjs'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile,rm,access,cp} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {build} from 'vite'
import {createHiCanvasService} from '../server/local-service.mjs'
import {syntheticSlideHtml,syntheticCdnUrl} from './content-host/slides-cases.js'

const root=fileURLToPath(new URL('../',import.meta.url)),baseOutput=join(root,'.scratch/content-slides-smoke')
const port=Number(process.env.HICANVAS_SLIDES_PORT),observe=process.argv.includes('--observe')
if(!Number.isInteger(port)||port<43300||port>65535)throw new Error('先在白板登记专用端口，再指定HICANVAS_SLIDES_PORT（43300以上）。')
await mkdir(baseOutput,{recursive:true})
const runtime=await mkdtemp(join(baseOutput,'runtime-')),distDir=join(runtime,'dist'),variants=process.argv.includes('--inline')?[true]:observe?[false]:[false,true],results=[]
let service
async function closeService(){if(service){service.closeAllConnections();await new Promise(resolve=>service.close(resolve));service=null}}
async function electron(executable,config){
  // A terminated Electron can exit 0. Never accept evidence left by an older
  // process when the current browser did not produce its own result.
  await rm(config.result,{force:true})
  const manifest=join(runtime,'manifest.json');await writeFile(manifest,JSON.stringify(config))
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,[join(root,'tools/content-host/slides-electron.mjs'),manifest],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:'inherit'})
    let force
    const timer=setTimeout(()=>{child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),5000)},180000)
    child.once('error',error=>{clearTimeout(timer);clearTimeout(force);reject(error)})
    child.once('close',code=>{clearTimeout(timer);clearTimeout(force);code===0?resolve():reject(new Error('幻灯片原生回归失败：'+config.result))})
  })
  return JSON.parse(await readFile(config.result,'utf8'))
}
try{
  await build({root,build:{outDir:distDir,rollupOptions:{input:join(root,'tools/content-host/slides.html')}},logLevel:'warn'})
  const executable=process.env.HICANVAS_TEST_ELECTRON||join(root,'node_modules/electron/dist',(await readFile(join(root,'node_modules/electron/path.txt'),'utf8')).trim())
  await access(executable,constants.X_OK)
  for(const inline of variants){
    const output=join(baseOutput,inline?'inline':''),variantRoot=join(runtime,inline?'inline':'file'),reports=[]
    await mkdir(output,{recursive:true})
    for(const enabled of observe?[false]:[false,true]){
      const key=enabled?'on':'off',canvasDir=join(variantRoot,key,'canvas'),slidesId='shape:synthetic-slides'
      service=createHiCanvasService({distDir,canvasDir,settingsDir:join(variantRoot,key,'settings'),contentHostEnabled:enabled})
      await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(port,'127.0.0.1',resolve)})
      let exportWrites=0;service.prependListener('request',req=>{if(req.url.startsWith('/api/exports/file'))exportWrites++})
      const url='http://127.0.0.1:'+port
      async function api(path,method='GET',body){const response=await fetch(url+path,{method,headers:{'x-hicanvas-client':'1','content-type':'application/json','connection':'close'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result}
      const {conversation}=await api('/api/conversations/open','POST',{createNew:true,title:'合成幻灯片翻页回归'})
      const query='?conversation='+conversation.id,before=await api('/api/canvas'+query)
      await api('/api/canvas/operations'+query,'POST',{expectedRevision:before.revision,operations:[{type:'create_shape',id:slidesId,shapeType:'frame',props:{w:1048,h:600,name:'合成幻灯片'},meta:{cowartAiSlides:true,cowartAiSlidesVersion:1,cowartAiSlidesFlow:'horizontal',cowartAiSlidesGap:32,cowartAiSlidesPadding:12}}]})
      const localPrefix=url+'/c/'+conversation.id+'/assets/'
      if(enabled){
        const assets=join(canvasDir,'conversations',conversation.id,'assets');await mkdir(assets,{recursive:true})
        const wav=Buffer.alloc(44+160);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(160,40)
        for(const [name,value] of [['fixture.css','@import "nested.css";@font-face{font-family:SlidesFixture;src:url(font.woff2)}.local-resource{font-family:SlidesFixture;color:rgb(12,34,56);background-image:url(pixel.svg)}'],['font.woff2',await readFile(join(root,'renderer/fonts/files/ibm-plex-sans/IBMPlexSans-Medium.woff2'))],['nested.css','.local-resource{border-color:rgb(7,8,9)}'],['fixture.js','window.syntheticLocalReady=true'],['pixel.svg','<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'],['tone.wav',wav]])await writeFile(join(assets,name),value)
      }
      for(let number=1;number<=3;number++){
        const state=await api('/api/canvas'+query)
        let html=syntheticSlideHtml(number)
        if(enabled&&number===2)html=html.replace('</head>','<link rel="stylesheet" href="'+localPrefix+'fixture.css"><script defer src="'+localPrefix+'fixture.js"></script></head>').replace('</body>','<div class="local-resource">Local 本地素材<img id="local-image" src="'+localPrefix+'pixel.svg"><audio id="local-audio" preload="metadata" src="'+localPrefix+'tone.wav"></audio></div></body>')
        const inserted=await api('/api/canvas/html'+query,'POST',{expectedRevision:state.revision,draftShapeId:slidesId,htmlContent:html,displayWidth:1024,displayHeight:576})
        // File-backed drafts are the inherited same-origin click path. Keep this
        // representation explicit so data: frame opacity cannot silently fake it.
        if(!inline)await api('/api/canvas/operations'+query,'POST',{expectedRevision:inserted.revision,operations:[{type:'update',id:inserted.shapeId,changes:{props:{url:'http://cowart.local'+inserted.assetUrl}}}]})
      }
      const health=await api('/api/health')
      const app=await electron(executable,{url:url+'/tools/content-host/slides.html'+query,profile:join(variantRoot,'profile-app-'+key),slidesId,enabled,inline,localAssets:enabled,observe,output,result:join(output,'app-'+key+'.json'),contentPort:health.contentHost.port})
      reports.push(app)
      if(enabled){assert.ok(app.observations.export.externalResources.includes(syntheticCdnUrl),'导出返回原外部引用清单');assert.equal(exportWrites,8,'两个成功入口共写8次；后页缺失预检失败不增加写入')}
      const directory=resolve(app.observations.export.filePath)
      if(!directory.startsWith(runtime+sep))throw new Error('合成导出路径越界')
      const offlineDir=join(output,'export-'+key);await mkdir(offlineDir,{recursive:true});await cp(directory,offlineDir,{recursive:true})
      await closeService()
      await assert.rejects(fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)}))
      reports.push(await electron(executable,{url:pathToFileURL(join(offlineDir,'Play.html')).href,profile:join(variantRoot,'profile-offline-'+key),enabled,localAssets:enabled,observe,output,result:join(output,'offline-'+key+'.json'),serverStopped:true}))
    }
    await writeFile(join(output,observe?'legacy-observation.json':'report.json'),JSON.stringify({reports},null,2)+'\n')
    results.push({inline,reports})
  }
  if(results.length===2){
    const readings=report=>report.observations.clicks.map(({id,advance})=>({id,advance}))
    assert.deepEqual(readings(results[0].reports[2]),readings(results[1].reports[2]),'同一合成幻灯片ON时两种保存地址的29类点击逐项一致')
    assert.ok(results[1].reports[0].observations.clicks.every(item=>!item.advance),'OFF时data URL仍保持旧版点击不翻页')
    await writeFile(join(baseOutput,'comparison.json'),JSON.stringify({sameOnClickReadings:true,inlineOffClicksNeverAdvance:true,clicks:readings(results[0].reports[2])},null,2)+'\n')
  }
  console.log('幻灯片应用内/断服离线对照通过；证据：'+baseOutput)
}finally{await closeService();await rm(runtime,{recursive:true,force:true})}
