import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readdir,readFile} from 'node:fs/promises'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {build} from 'esbuild'
import {stageContentChannelAssets} from './content-channel-assets.mjs'

test('桌面固定模块白名单随打包服务运行，不借源码目录或发布父通道模块',async t=>{
  const scratch=fileURLToPath(new URL('../.scratch/',import.meta.url)),stage=await mkdtemp(join(scratch,'channel-pack-'))
  t.after(()=>rm(stage,{recursive:true,force:true}))
  await mkdir(join(stage,'runtime'))
  await stageContentChannelAssets(stage)
  assert.deepEqual((await readdir(join(stage,'content-channel'))).sort(),['bootstrap.js','capture-protocol.js','capture.js','child.js','content-policy.js','edit-protocol.js','edit.js','film-controller.js','film-export-protocol.js','film-export.js','film-time.js','offline-slides.js','protocol.js','slides.js'])
  await build({entryPoints:[fileURLToPath(new URL('../server/content-host.mjs',import.meta.url))],outfile:join(stage,'runtime/host.mjs'),bundle:true,platform:'node',format:'esm',external:['esbuild'],logLevel:'silent'})
  // Fresh Node process also proves the packaged module is independent of the
  // source process' module cache. The generated script has a fixed literal import.
  const script=`
    import {registerHooks} from 'node:module';
    import {fileURLToPath} from 'node:url';
    registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(!result.url.startsWith('node:')&&!fileURLToPath(result.url).startsWith(${JSON.stringify(stage+'/')}))throw new Error('禁止借用源码或node_modules: '+result.url);return result}});
    const {createContentHost}=await import(${JSON.stringify(pathToFileURL(join(stage,'runtime/host.mjs')).href)});
    import http from 'node:http';
    const host=createContentHost();
    try {
      const instance=await host.register({html:'<h1>bundled</h1>',parentOrigin:'http://127.0.0.1:43396'});
      const url=new URL(instance.url);
      const get=path=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:url.port,path,headers:{host:url.host}},res=>{let text='';res.on('data',part=>{text+=part});res.on('end',()=>resolve({status:res.statusCode,text}))}).once('error',reject)});
      const page=await get(url.pathname),bootstrap=page.text.match(/src="([^"]+)"/)[1];
      console.log(JSON.stringify({script:await get(bootstrap),capture:await get('/.hicanvas-channel/'+instance.id+'/capture.js'),edit:await get('/.hicanvas-channel/'+instance.id+'/edit.js'),film:await get('/.hicanvas-channel/'+instance.id+'/film-export.js'),privateStatus:(await get('/.hicanvas-channel/'+instance.id+'/parent.js')).status}));
    }finally{await host.close()}
  `
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{timeout:10000})
  const result=JSON.parse(stdout)
  assert.equal(result.script.status,200)
  assert.match(result.script.text,/installContentChild/)
  assert.equal(result.privateStatus,404)
  const {readChannelAssets}=await import('../server/content-channel-assets.mjs')
  const source=new Map(await readChannelAssets()).get('capture.js')
  assert.equal(result.capture.status,200)
  assert.equal(result.capture.text,source.toString('utf8'))
  assert.equal(await readFile(join(stage,'content-channel/capture.js'),'utf8'),source.toString('utf8'))
  assert.match(result.capture.text,/hiCanvas capture-bundle sha256:[a-f0-9]{64}/)
  const film=new Map(await readChannelAssets()).get('film-export.js').toString('utf8')
  assert.equal(result.film.status,200);assert.equal(result.film.text,film)
  assert.equal(await readFile(join(stage,'content-channel/film-export.js'),'utf8'),film)
  assert.match(film,/hiCanvas film-export-bundle sha256:[a-f0-9]{64}/)
  assert.ok(/MPL-2\.0|Mozilla Public[\s*]*License/.test(film),'打包结果必须保留MPL许可声明')
  assert.match(film,/from[ ]*["']\.\/capture\.js["']/)
  const edit=new Map(await readChannelAssets()).get('edit.js').toString('utf8')
  assert.equal(result.edit.status,200);assert.equal(result.edit.text,edit)
  assert.equal(await readFile(join(stage,'content-channel/edit.js'),'utf8'),edit)
  assert.match(edit,/hiCanvas edit-bundle sha256:[a-f0-9]{64}/)
  const offline=new Map(await readChannelAssets()).get('offline-slides.js').toString('utf8')
  assert.equal(await readFile(join(stage,'content-channel/offline-slides.js'),'utf8'),offline)
  assert.match(offline,/hiCanvas offline-slides-bundle sha256:[a-f0-9]{64}/)
})
