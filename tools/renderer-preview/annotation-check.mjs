import '../test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { setTimeout as delay } from 'node:timers/promises'
import { startInteractionPreview } from './service.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url))
const red=[...['clipboard','dialog','network','print','file'].map(name=>[`native-${name}`,name==='file'?'file-path':name]),...['page','frame'].flatMap(scope=>['clipboard','dialog','network','model','download'].map(name=>[`${scope}-${name}`,name]))]
export async function runAnnotationSmoke({port=Number(process.env.HICANVAS_ANNOTATION_PORT||43392)}={}){
  const executable=process.env.HICANVAS_TEST_ELECTRON,output=join(root,'.scratch/annotation-smoke')
  if(!executable)throw new Error('先设置HICANVAS_TEST_ELECTRON，复用已安装的Electron。')
  await access(executable,constants.X_OK);await mkdir(output,{recursive:true})
  const run=await mkdtemp(join(output,'run-')),controller=new AbortController(),results=[],serviceNetwork=[]
  let preview,child,closed
  const interrupt=()=>{controller.abort(new Error('标注检查已停止。'));child?.kill('SIGKILL')}
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt)
  const sourceFiles=['engine/index.js','renderer/export-bounds.js','renderer/text-editing-layout.js',...['index.js','create-annotation.js','annotation-plan.js','annotation-capture.js','snapshot-output.js','export.js','text-editing.js','text-input.js','shortcuts.js','creation-controls.js','creation-presets.js'].map(name=>`engine/interaction/${name}`),...['annotation-check.mjs','annotation-smoke.mjs','annotation-fixture.js','annotation-probe.js','annotation-ui.js','main.js','creation-ui.js','electron.mjs','native-suites.mjs','native-suite-runner.mjs','service.mjs'].map(name=>`tools/renderer-preview/${name}`)]
  async function fingerprint(){const hash=createHash('sha256');for(const file of sourceFiles)hash.update(file).update(await readFile(join(root,file)));return hash.digest('hex')}
  const source=await fingerprint(),origins=new Set()
  const observe=({request})=>{
    try{const url=request.origin?new URL(request.path,String(request.origin)):new URL(request.path,`${request.protocol||'http:'}//${request.getHeader('host')}`);serviceNetwork.push({url:url.href,external:!origins.has(url.origin)})}
    catch(error){serviceNetwork.push({external:true,error:String(error)})}
  }
  const channels=['http.client.request.start','undici:request:create'].map(name=>channel(name));for(const value of channels)value.subscribe(observe)
  try{
    controller.signal.throwIfAborted()
    preview=await startInteractionPreview({port,dataDir:join(run,'data'),watch:false});origins.add(preview.url)
    const response=await fetch(preview.url+'/api/health'),health=response.ok?await response.json():null
    const contentPort=health?.contentHost?.port
    if(contentPort)origins.add(`http://127.0.0.1:${contentPort}`)
    for(const [mode,expected]of [...red,['green'],['smoke']]){
      controller.signal.throwIfAborted();assert.equal(await fingerprint(),source,'守卫证明和专项之间源码发生变化。')
      const manifest=join(run,`${mode}.json`),result=join(run,`${mode}-result.json`),refused=join(root,'.scratch',`annotation-refused-${basename(run)}.json`)
      if(mode==='native-file')await assert.rejects(access(refused),{code:'ENOENT'})
      await writeFile(manifest,JSON.stringify({url:preview.url,mode,annotationOnly:true,contentPort,output,result:mode==='native-file'?refused:result,profile:join(run,`profile-${mode}`),fingerprint:source}))
      let stderr=''
      const code=await new Promise((yes,no)=>{
        child=spawn(executable,[resolve(root,'tools/renderer-preview/electron.mjs'),'--host-resolver-rules=MAP *.localhost 127.0.0.1, MAP localhost 127.0.0.1',manifest],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:['ignore','inherit','pipe']})
        child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-32000);process.stderr.write(chunk)})
        closed=new Promise(resolve=>child.once('close',resolve))
        const timer=setTimeout(()=>{child.kill('SIGKILL');no(new Error(`标注原生检查超时：${mode}`))},170000)
        child.once('error',error=>{clearTimeout(timer);no(error)});child.once('close',value=>{clearTimeout(timer);yes(value)})
      })
      let report
      if(mode==='native-file'){
        assert.notEqual(code,0);assert.match(stderr,/ANNOTATION_DENIED:file-path/)
        await assert.rejects(access(refused),{code:'ENOENT'});await assert.rejects(access(result),{code:'ENOENT'})
        report={ok:false,mode,fingerprint:source,pid:child.pid,violations:['file-path'],rejectedBeforeWrite:true,stderr}
      }else report=JSON.parse(await readFile(result,'utf8'))
      const evidence=join(output,`${mode}-${basename(run)}.json`)
      await writeFile(evidence,JSON.stringify({...report,serviceNetwork},null,2))
      assert.equal(report.mode,mode);assert.equal(report.fingerprint,source)
      assert.equal(serviceNetwork.filter(row=>row.external).length,0,'合成本机服务发出了外部请求。')
      if(expected){assert.notEqual(code,0);assert.equal(report.error,undefined,report.error);assert.deepEqual(report.violations,[expected])}
      else{assert.equal(code,0,report.error);assert.equal(report.ok,true);assert.deepEqual(report.violations,[])}
      results.push({mode,code,expected:expected||'success',evidence,pid:report.pid})
    }
    assert.equal(await fingerprint(),source)
    await writeFile(join(output,'result.json'),JSON.stringify({ok:true,fingerprint:source,results,serviceNetwork},null,2))
    console.log(`标注：15红/1绿隔离探针、原生绘制/文字/历史/失焦、实际PNG像素与尺寸边界通过：${output}`)
  }finally{
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt)
    try{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');if(!await Promise.race([closed.then(()=>true),delay(1000).then(()=>false)]))child.kill('SIGKILL')}await closed}
    finally{try{await preview?.close()}finally{for(const value of channels)value.unsubscribe(observe);await writeFile(join(output,`service-network-${basename(run)}.json`),JSON.stringify(serviceNetwork,null,2));await rm(run,{recursive:true,force:true})}}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runAnnotationSmoke()
