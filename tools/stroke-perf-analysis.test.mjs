import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {strokeTraceLabel} from './perf/strokes-diagnostics.mjs'
import {summarizeStrokeCpu,summarizeStrokeTimeline} from './perf/strokes-analysis.mjs'

test('CPU归因按样本命中及祖先栈统计，不重复相加或把负时间差转成耗时',()=>{
  const frame=functionName=>({functionName,url:'stroke.js',lineNumber:0})
  const profile={startTime:0,endTime:7000,nodes:[{id:1,callFrame:frame('(root)'),children:[2,4,5]},{id:2,callFrame:frame('getStrokeGeometry'),children:[3]},{id:3,callFrame:frame('decodeStrokePoints')},{id:4,callFrame:frame('strokePath')},{id:5,callFrame:frame('(garbage collector)')}],samples:[3,4,5],timeDeltas:[1000,2000,3000]}
  const result=summarizeStrokeCpu(profile)
  assert.deepEqual(result.buckets,{outline:1,pathString:1,gc:1,other:0})
  assert.equal(result.sampledHits,3);assert.equal(result.durationMs,7)
  assert.equal(result.inclusive.find(row=>row.frame.startsWith('(root)')).hits,3)
  assert.equal(summarizeStrokeCpu({...profile,timeDeltas:[1000,-1,3000]}).negativeDeltas,1)
  assert.throws(()=>summarizeStrokeCpu({...profile,samples:[999]}),/无效CPU/)
})
test('时间线只累计完整时长事件，保留跨线程分项而不声称总帧时长',()=>{
  const result=summarizeStrokeTimeline({traceEvents:[{name:'Paint',ph:'X',dur:1000},{name:'Paint',ph:'X',dur:2000},{name:'RasterTask',ph:'X',dur:4000},{name:'Paint',ph:'B',dur:9000}]})
  assert.deepEqual(result.slices.Paint,{ms:3,count:3});assert.deepEqual(result.slices.RasterTask,{ms:4,count:1})
  assert.equal(result.slices.Layout.ms,0)
})

test('多轮诊断和补测的每份阶段与消融文件名独立，不覆盖别轮证据',()=>{
  const labels=[]
  for(const stage of ['baseline','retest'])for(const renderer of ['legacy','preview'])for(const count of [1000,5000])for(const repeat of [1,2,3])for(const phase of ['open','pan','ablation-original-before','ablation-opaque','ablation-original-after'])labels.push(strokeTraceLabel({stage,renderer,count,repeat},phase))
  assert.equal(new Set(labels).size,labels.length)
})
