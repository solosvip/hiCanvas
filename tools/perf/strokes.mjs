import '../test-sandbox.mjs'
import {execFileSync} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import os from 'node:os'
import {benchmarkViewport,parseOptions,measurementPlan,isolatedDirectories,makeDirectories,repositoryRoot,scratchPath,directoryVariables} from './config.mjs'
import {prepareFixture} from './prepare.mjs'
import {strokeSummary,assertStrokeBudget,isFormalStrokeRun} from './strokes-report.mjs'
import {runStrokeProcess} from './strokes-process.mjs'

if(process.argv.includes('--help')){
  console.log(`Node24，先 npm ci --ignore-scripts 和 npm run build；先在白板登记两端口与全量检查，轮到再运行。
HICANVAS_TEST_ELECTRON=<已有Electron> node tools/perf/strokes.mjs --port 43392 --preview-port 43393 --load-note '白板独占；其他系统负载说明'
默认：500/2000/5000笔迹（画笔荧光各半、每笔129点），另加500底板+500笔迹；每板一条129点斜线作原生拖动目标，低缩放下避开手柄；新旧交替三轮，各阶段2500ms。
--sizes 500,2000,5000 --runs 3 --duration-ms 2500 --output .scratch/stroke-perf --load-note <说明>；混合样本始终包含。
先各跑一份不计分预热；每次新窗口/内存session，打开到可选中、字体及全部图片解码、双rAF就绪。帧率取真实paint，另存rAF。
任一项不达90%帧率/110%打开，则同进程立即补该规模的新旧各一轮，按《架构说明》第8节以补测为准；失败退出1。
HICANVAS_STROKE_DIAG=1 可另跑含打开CPU采样、DOM/路径统计及阶段追踪的诊断；HICANVAS_PERF_TRACE=1 只追踪阶段，有追踪开销的样本不得作正式门槛。默认两版均生产构建（新预览不压缩以保留诊断函数名）；HICANVAS_STROKE_DEV=1 可单独复现开发宿主成本。
HICANVAS_STROKE_DIAG=1 HICANVAS_STROKE_ABLATION=1 增加5000条新版不透明组的A/B/A反证；视觉不等价，只定位、不算验收。
所有资料与临时环境仅在本worktree .scratch；不访问真实画板或API。结果保存report.json、samples.json、画面及系统负载。`)
  process.exit(0)
}
const options=parseOptions(['--renderer','both','--output','.scratch/stroke-perf',...process.argv.slice(2)])
if(process.env.HICANVAS_STROKE_ABLATION==='1'&&process.env.HICANVAS_STROKE_DIAG!=='1')throw new Error('透明度消融只允许诊断运行。')
if(options.renderer!=='both')throw new Error('笔迹对照需要新旧两版。')
options.sizes=[...options.sizes,1000].sort((a,b)=>a-b)
const executable=process.env.HICANVAS_TEST_ELECTRON
if(!executable)throw new Error('指定已有 HICANVAS_TEST_ELECTRON；工具不下载运行时。')
const outputParent=await scratchPath(join(repositoryRoot,options.output));await mkdir(outputParent,{recursive:true})
const outputDir=await mkdtemp(join(outputParent,'run-')),runtime=await mkdtemp(join(outputDir,'runtime-'))
for(const name of directoryVariables)process.env[name]=join(runtime,name)
const directories=await isolatedDirectories();await makeDirectories(directories)
const command=(program,args)=>{try{return execFileSync(program,args,{encoding:'utf8'}).trim()}catch{return 'unknown'}}
let service,preview
const cancellation=new AbortController()
const interrupt=()=>cancellation.abort(new Error('笔迹测量已中断。'))
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt)
try{
  await access(executable,constants.X_OK)
  const {createHiCanvasService}=await import('../../server/local-service.mjs')
  const {createConversations}=await import('../../server/conversations.mjs')
  const {createStrokeFixture}=await import('./strokes-fixture.mjs')
  const {startStrokePreview,startProductionStrokePreview}=await import('./strokes-host.mjs')
  if(!(await readFile(join(repositoryRoot,'dist/index.html'),'utf8')).includes('/app-assets/'))throw new Error('先运行npm run build。')
  const workspace=createConversations(process.env.HICANVAS_CANVAS_DIR),fixtures=new Map()
  service=createHiCanvasService({distDir:join(repositoryRoot,'dist'),canvasDir:process.env.HICANVAS_CANVAS_DIR,settingsDir:process.env.HICANVAS_SETTINGS_DIR,contentHostEnabled:false})
  await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(options.port,'127.0.0.1',resolve)})
  const productionPreview=process.env.HICANVAS_STROKE_DEV!=='1'
  preview=productionPreview?await startProductionStrokePreview(fixtures,options.previewPort,join(runtime,'preview-dist')):await startStrokePreview(fixtures,options.previewPort)
  const baseUrl=`http://127.0.0.1:${options.port}`,cases=[],retests=[]
  const preparePair=async(count,repeat,stage)=>{
    cancellation.signal.throwIfAborted()
    const key=`${stage}-${count}-${repeat}`,conversation=await workspace.open({createNew:true,title:'Synthetic strokes '+key}),current=await workspace.read(conversation.id)
    const fixture=createStrokeFixture(count,current.snapshot)
    await prepareFixture(workspace,conversation.id,current,fixture.snapshot)
    fixture.snapshot=(await workspace.read(conversation.id)).snapshot
    await workspace.sidecar(conversation.id,'view',fixture.viewState)
    fixtures.set(key,JSON.stringify(fixture))
    const {snapshot,viewState,...description}=fixture,snapshotHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    return ['legacy','preview'].map(renderer=>({...description,camera:viewState.camera,snapshotHash,renderer,repeat,stage,url:renderer==='legacy'?`${baseUrl}/?conversation=${conversation.id}`:`${preview.url}/?case=${key}`}))
  }
  cases.push(...await preparePair(options.sizes[0],1,'warmup'))
  for(let repeat=1;repeat<=options.runs;repeat++)for(const count of options.sizes)cases.push(...await preparePair(count,repeat,'baseline'))
  for(const count of options.sizes)retests.push(...await preparePair(count,1,'retest'))
  const resultPath=join(outputDir,'samples.json'),manifestPath=join(outputDir,'manifest.json')
  const manifest={cases,retests,origins:[baseUrl,preview.url],durationMs:options.durationMs,options,tracing:process.env.HICANVAS_PERF_TRACE==='1'||process.env.HICANVAS_STROKE_DIAG==='1',diagnostic:process.env.HICANVAS_STROKE_DIAG==='1',ablation:process.env.HICANVAS_STROKE_ABLATION==='1',outputDir,resultPath}
  await writeFile(manifestPath,JSON.stringify(manifest))
  const metadata={timestamp:new Date().toISOString(),revision:command('git',['-C',repositoryRoot,'rev-parse','HEAD']),dirty:command('git',['-C',repositoryRoot,'status','--porcelain'])!=='',geometryHash:createHash('sha256').update(await readFile(join(repositoryRoot,'renderer/stroke-geometry.js'))).digest('hex'),hardware:command('/usr/sbin/sysctl',['-n','hw.model']),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryGiB:os.totalmem()/2**30,loadBefore:os.loadavg(),loadNote:options.loadNote,processesBefore:command('/bin/ps',['-Ao','pid=,pcpu=,comm=']).split('\n').toSorted((a,b)=>Number(b.trim().split(/\s+/)[1])-Number(a.trim().split(/\s+/)[1])).slice(0,10),viewport:benchmarkViewport,hosts:{legacy:'production dist',preview:productionPreview?'production synthetic preview; same engine/input and renderer':'Vite development synthetic preview; same engine/input and renderer'},opening:'navigation through exact shape count, fonts, full image decoding, double rAF and native stroke selection; services and pre-seeding excluded',cache:'untimed legacy/preview warmup, then fresh in-memory session per sample; common warm browser/GPU process and OS caches',formal:isFormalStrokeRun({options,tracing:manifest.tracing,productionPreview}),tracing:manifest.tracing,options,plan:measurementPlan(options)}
  await writeFile(join(outputDir,'environment.json'),JSON.stringify(metadata,null,2))
  const logs=[]
  try{
    await runStrokeProcess({command:executable,args:[fileURLToPath(new URL('./strokes-electron.mjs',import.meta.url)),manifestPath],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},signal:cancellation.signal,timeoutMs:(cases.length+retests.length)*90000,onStdout:bytes=>{logs.push(bytes);process.stdout.write(bytes)},onStderr:bytes=>{logs.push(bytes);process.stderr.write(bytes)}})
  }finally{await writeFile(join(outputDir,'electron.log'),Buffer.concat(logs))}
  const measured=JSON.parse(await readFile(resultPath,'utf8')),summary=strokeSummary(measured.samples,options)
  const report={metadata:{...metadata,finishedAt:new Date().toISOString(),loadAfter:os.loadavg()},...measured,...summary}
  await writeFile(join(outputDir,'report.json'),JSON.stringify(report,null,2))
  console.table(report.comparisons.map(item=>({count:item.count,open:item.openRatio,pan:item.panPaintRatio,zoom:item.zoomPaintRatio,drag:item.dragPaintRatio,pass:item.pass,basis:item.basis})))
  console.log('笔迹证据：'+outputDir)
  assertStrokeBudget(report,options.sizes)
}finally{
  service?.closeAllConnections()
  try{if(service)await new Promise(resolve=>service.close(resolve))}
  finally{try{await preview?.close()}finally{await rm(await scratchPath(runtime),{recursive:true,force:true})}}
  process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt)
}
