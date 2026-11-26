import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {strokeVerdict,assertStrokeBudget,strokeSummary,assertPairedFixtures,isFormalStrokeRun} from './perf/strokes-report.mjs'

const pair=(openRatio=1,frameRatio=1)=>({count:500,openRatio,panPaintRatio:frameRatio,zoomPaintRatio:frameRatio,dragPaintRatio:frameRatio})
test('笔迹性能门禁接受110%打开与90%绘制帧率边界，拒绝缺项和无效测量',()=>{
  assert.equal(strokeVerdict(pair(1.1,.9)).pass,true)
  assert.equal(strokeVerdict(pair(1.1001,.9)).pass,false)
  assert.equal(strokeVerdict(pair(1,.8999)).pass,false)
  for(const value of [null,NaN,Infinity,0])assert.throws(()=>strokeVerdict({...pair(),dragPaintRatio:value}),/无效/)
})
test('预算断言不能把失败、缺少规定样本或空报告报成通过',()=>{
  const comparisons=[500,1000,2000,5000].map(count=>({...pair(),count}))
  assert.doesNotThrow(()=>assertStrokeBudget({comparisons},[500,1000,2000,5000]))
  assert.throws(()=>assertStrokeBudget({comparisons:[]},[500]),/缺失/)
  assert.throws(()=>assertStrokeBudget({comparisons:comparisons.slice(1)},[500,1000,2000,5000]),/缺失/)
  assert.throws(()=>assertStrokeBudget({comparisons:[pair(1,.8)]},[500]),/不达标/)
})

test('三轮失败后按既定切换规则使用当场补测，保留原判定；补测缺一版拒绝结论',()=>{
  const sample=(renderer,repeat,stage,fps)=>({renderer,count:500,repeat,stage,openMs:100,counts:{image:0},assetCount:0,snapshotHash:'a'.repeat(64),ready:{camera:{x:0,y:0,z:.1},viewport:{width:1280,height:800,devicePixelRatio:2}},phases:Object.fromEntries(['pan','zoom','drag'].map(name=>[name,{raf:{fps,p95FrameMs:16},paint:{fps,p95FrameMs:16}}]))})
  const baseline=[1,2,3].flatMap(repeat=>[sample('legacy',repeat,'baseline',60),sample('preview',repeat,'baseline',40)])
  const options={renderer:'both',sizes:[500],runs:3}
  assert.equal(strokeSummary(baseline,options).comparisons[0].pass,false)
  const retest=[sample('legacy',1,'retest',60),sample('preview',1,'retest',60)]
  const report=strokeSummary([...baseline,...retest],options),comparison=report.comparisons[0]
  assert.equal(comparison.pass,true);assert.equal(comparison.initial.pass,false)
  assert.equal(comparison.basis,'immediate paired retest')
  assert.throws(()=>strokeSummary([...baseline,retest[0]],options),/样本总数/)
})

test('配对两版必须使用完全相同的输入快照、视角、视口及图片数量',()=>{
  const old={renderer:'legacy',stage:'baseline',count:500,repeat:1,snapshotHash:'a'.repeat(64),counts:{draw:250,highlight:250,image:0},assetCount:0,ready:{camera:{x:1,y:2,z:.1},viewport:{width:1280,height:800,devicePixelRatio:2},renderedImages:0}}
  const current={...old,renderer:'preview'}
  assert.doesNotThrow(()=>assertPairedFixtures([old,current]))
  for(const patch of [{snapshotHash:'b'.repeat(64)},{ready:{...old.ready,camera:{x:1,y:2,z:.2}}},{ready:{...old.ready,viewport:{...old.ready.viewport,width:640}}},{ready:{...old.ready,renderedImages:1}}])assert.throws(()=>assertPairedFixtures([old,{...current,...patch}]),/输入不一致/)
})

test('正式报告只标记双生产宿主、完整三轮四组及完整时段；开发、追踪和预检均不冒充验收',()=>{
  const complete={productionPreview:true,tracing:false,options:{renderer:'both',runs:3,sizes:[500,1000,2000,5000],durationMs:2500}}
  assert.equal(isFormalStrokeRun(complete),true)
  for(const patch of [{productionPreview:false},{tracing:true},{options:{...complete.options,runs:1}},{options:{...complete.options,sizes:[500]}},{options:{...complete.options,durationMs:500}}])assert.equal(isFormalStrokeRun({...complete,...patch}),false)
})
