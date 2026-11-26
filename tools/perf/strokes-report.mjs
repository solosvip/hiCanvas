import {summarizeSamples} from './report.mjs'

export function isFormalStrokeRun({options,tracing,productionPreview}){
  return productionPreview&&!tracing&&options.renderer==='both'&&options.runs>=3&&options.durationMs>=2500&&[500,1000,2000,5000].every(count=>options.sizes.includes(count))
}

export function strokeVerdict(comparison){
  const fields=['openRatio','panPaintRatio','zoomPaintRatio','dragPaintRatio']
  for(const key of fields)if(typeof comparison[key]!=='number'||!Number.isFinite(comparison[key])||comparison[key]<=0)throw new Error(`无效笔迹测量：${key}`)
  const checks=fields.map(metric=>({metric,ratio:comparison[metric],limit:metric==='openRatio'?1.1:.9,pass:metric==='openRatio'?comparison[metric]<=1.1:comparison[metric]>=.9}))
  return {...comparison,checks,pass:checks.every(check=>check.pass)}
}
export function assertStrokeBudget(report,sizes){
  if(!sizes.length)throw new Error('缺失规定的笔迹样本。')
  for(const count of sizes){
    const values=report.comparisons.filter(item=>item.count===count)
    if(values.length!==1)throw new Error(`缺失或重复的笔迹样本：${count}`)
    const verdict=strokeVerdict(values[0])
    if(!verdict.pass)throw new Error(`笔迹性能不达标：${count}／${verdict.checks.filter(check=>!check.pass).map(check=>check.metric).join('、')}`)
  }
}
export function assertPairedFixtures(samples){
  const pairs=new Map()
  for(const sample of samples){
    const key=`${sample.stage}/${sample.count}/${sample.repeat}`
    if(!pairs.has(key))pairs.set(key,[])
    pairs.get(key).push(sample)
  }
  for(const [key,pair] of pairs){
    const legacy=pair.find(item=>item.renderer==='legacy'),preview=pair.find(item=>item.renderer==='preview')
    if(pair.length!==2||!legacy||!preview)throw new Error(`配对样本总数不符：${key}`)
    const identity=item=>JSON.stringify({snapshotHash:item.snapshotHash,counts:item.counts,assetCount:item.assetCount,viewport:item.ready?.viewport,renderedImages:item.ready?.renderedImages})
    const sameCamera=['x','y','z'].every(axis=>Number.isFinite(legacy.ready?.camera?.[axis])&&Number.isFinite(preview.ready?.camera?.[axis])&&Math.abs(legacy.ready.camera[axis]-preview.ready.camera[axis])<1e-6)
    if(!/^[a-f0-9]{64}$/.test(legacy.snapshotHash)||!sameCamera||!legacy.ready?.viewport||identity(legacy)!==identity(preview))throw new Error(`两版输入不一致：${key}`)
  }
}
export function strokeSummary(samples,options){
  assertPairedFixtures(samples)
  const baseline=summarizeSamples(samples.filter(sample=>sample.stage==='baseline'),options)
  const comparisons=baseline.comparison.map(initial=>{
    const retest=samples.filter(sample=>sample.stage==='retest'&&sample.count===initial.count)
    if(!retest.length)return {...strokeVerdict(initial),basis:options.runs===3?'three-round median':`${options.runs}-round median (not formal)`}
    const current=summarizeSamples(retest,{...options,sizes:[initial.count],runs:1})
    return {...strokeVerdict(current.comparison[0]),basis:'immediate paired retest',initial:strokeVerdict(initial)}
  })
  return {baseline,comparisons}
}
