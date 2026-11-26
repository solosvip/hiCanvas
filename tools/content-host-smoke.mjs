import './test-sandbox.mjs'
import {spawn} from 'node:child_process'
import {createServer,get} from 'node:http'
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {createHiCanvasService} from '../server/local-service.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const close=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
const contentStatus=url=>new Promise((resolve,reject)=>{
  const target=new URL(url)
  get({hostname:'127.0.0.1',port:target.port,path:target.pathname,headers:{host:target.host}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode))}).once('error',reject)
})
export async function runContentHostSmoke(){
  const output=join(root,'.scratch/content-host-smoke');await mkdir(output,{recursive:true})
  const runtime=await mkdtemp(join(output,'runtime-')),distDir=join(runtime,'dist');await mkdir(distDir)
  const script=createServer((_req,res)=>{res.setHeader('content-type','text/javascript');res.end('window.__thirdPartyLoaded=true')})
  const servers=[script],results=[]
  try{
    const executable=process.env.HICANVAS_TEST_ELECTRON || join(root,'node_modules/electron/dist',(await readFile(join(root,'node_modules/electron/path.txt'),'utf8')).trim())
    await access(executable,constants.X_OK)
    await build({absWorkingDir:root,entryPoints:['tools/content-host/probe.js'],bundle:true,format:'esm',outfile:join(distDir,'probe.js'),logLevel:'silent'})
    await writeFile(join(distDir,'index.html'),'<meta charset="utf-8"><title>hiCanvas content security</title><pre id="result"></pre><script type="module">import {runContentSecurity} from "/probe.js";window.runContentSecurity=runContentSecurity</script>')
    await listen(script)
    for(const enabled of [false,true]){
      const service=createHiCanvasService({distDir,canvasDir:join(runtime,String(enabled),'canvas'),settingsDir:join(runtime,String(enabled),'settings'),contentHostEnabled:enabled})
      servers.push(service);await listen(service)
      const assets=join(runtime,String(enabled),'canvas','assets');await mkdir(assets,{recursive:true})
      const directScript=`const attempt=fn=>{try{fn();return false}catch{return true}};parent.postMessage({type:'direct-security',window:attempt(()=>parent.document.body),storage:attempt(()=>parent.localStorage.length),domain:attempt(()=>{document.domain='localhost'})},new URL(document.URL).origin)`
      await writeFile(join(assets,'direct.html'),`<script>${directScript}</script>`)
      await writeFile(join(assets,'direct.svg'),`<svg xmlns="http://www.w3.org/2000/svg"><script><![CDATA[${directScript}]]></script></svg>`)
      let acceptedWrites=0,deniedWrites=0
      service.prependListener('request',(req,res)=>{
        if(req.url==='/api/conversations/open'&&req.headers.origin?.includes('.localhost:'))res.once('finish',()=>{if(res.statusCode<400)acceptedWrites++;else deniedWrites++})
      })
      const url=`http://127.0.0.1:${service.address().port}`,health=await(await fetch(url+'/api/health')).json()
      const result=join(output,`${enabled?'on':'off'}.json`),manifest=join(runtime,'manifest.json')
      await writeFile(manifest,JSON.stringify({url,profile:join(runtime,'profile-'+enabled),output,result,contentSecurityOnly:true,contentPort:health.contentHost.port,securityEnabled:enabled,scriptUrl:`http://127.0.0.1:${script.address().port}/third-party.js`}))
      await new Promise((resolve,reject)=>{
        const child=spawn(executable,[join(root,'tools/renderer-preview/electron.mjs'),manifest],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:'inherit'})
        const timer=setTimeout(()=>{child.kill();reject(new Error('内容宿主浏览器门禁超时'))},30000)
        child.once('error',error=>{clearTimeout(timer);reject(error)})
        child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`内容安全门禁失败(${code})：${result}`))})
      })
      const evidence=JSON.parse(await readFile(result,'utf8'))
      if(acceptedWrites!==0||enabled&&deniedWrites<9)throw new Error('隔离内容对真实写接口的服务端拒绝计数不符')
      if(enabled)for(const url of evidence.urls){
        if(await contentStatus(url)!==403)throw new Error('卸载后内容实例仍可读取')
        evidence.checks.push({name:'卸载后旧内容URL立即失效',pass:true})
      }
      await writeFile(result,JSON.stringify({...evidence,acceptedWrites,deniedWrites},null,2)+'\n')
      results.push({enabled,checks:evidence.checks.length,acceptedWrites,deniedWrites})
    }
    console.log(JSON.stringify({contentSecurity:results,output}))
    return results
  }finally{
    for(const server of servers.reverse())await close(server)
    await rm(runtime,{recursive:true,force:true})
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runContentHostSmoke()
