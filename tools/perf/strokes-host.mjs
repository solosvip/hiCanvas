import {createServer as createViteServer,build,preview as previewBuild} from 'vite'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {repositoryRoot} from './config.mjs'

export async function startStrokePreview(fixtures,port){
  let vite
  const http=createServer((req,res)=>vite?vite.middlewares(req,res):res.writeHead(503).end())
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',resolve)})
  try{
    vite=await createViteServer({root:repositoryRoot,configFile:false,publicDir:false,appType:'mpa',optimizeDeps:{entries:['tools/perf/strokes-preview.html'],noDiscovery:true,include:['react','react-dom','react-dom/client','@tldraw/state','@tldraw/state-react','@tldraw/store','@tldraw/tlschema','@tldraw/utils']},server:{middlewareMode:true,hmr:{server:http,host:'127.0.0.1',clientPort:http.address().port}},plugins:[{name:'synthetic-stroke-fixtures',configureServer(server){server.middlewares.use((req,res,next)=>{
      const url=new URL(req.url,'http://localhost')
      if(url.pathname==='/')req.url='/tools/perf/strokes-preview.html'+url.search
      if(url.pathname!=='/fixture')return next()
      const fixture=fixtures.get(url.searchParams.get('case'))
      if(req.method!=='GET'||!fixture){res.writeHead(404).end();return}
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(fixture)
    })}}]})
  }catch(error){http.closeAllConnections();await new Promise(resolve=>http.close(resolve));throw error}
  return {url:`http://127.0.0.1:${http.address().port}`,async close(){try{await vite.close()}finally{http.closeAllConnections();await new Promise(resolve=>http.close(resolve))}}}
}

export async function startProductionStrokePreview(fixtures,port,outputDir){
  await build({root:repositoryRoot,configFile:false,publicDir:false,logLevel:'error',build:{outDir:outputDir,emptyOutDir:false,minify:false,rollupOptions:{input:join(repositoryRoot,'tools/perf/strokes-preview.html')}}})
  const preview=await previewBuild({root:repositoryRoot,configFile:false,publicDir:false,build:{outDir:outputDir},preview:{host:'127.0.0.1',port,strictPort:true},plugins:[{name:'production-stroke-fixtures',configurePreviewServer(server){server.middlewares.use((req,res,next)=>{
    const url=new URL(req.url,'http://localhost')
    if(url.pathname==='/')req.url='/tools/perf/strokes-preview.html'+url.search
    if(url.pathname!=='/fixture')return next()
    const fixture=fixtures.get(url.searchParams.get('case'))
    if(req.method!=='GET'||!fixture){res.writeHead(404).end();return}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(fixture)
  })}}]})
  return {url:`http://127.0.0.1:${port}`,async close(){preview.httpServer.closeAllConnections();await new Promise(resolve=>preview.httpServer.close(resolve))}}
}
