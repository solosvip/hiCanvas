import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {scratchPath,repositoryRoot} from './config.mjs'
import {summarizeStrokeCpu,summarizeStrokeTimeline} from './strokes-analysis.mjs'

const directory=await scratchPath(resolve(repositoryRoot,process.argv[2]||'.scratch/stroke-diagnostic'))
const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8')),results=[]
for(const sample of report.samples){
  const measurements={...Object.fromEntries((sample.ablation||[]).map(item=>['ablation-'+item.variant,item.phase.trace])),open:sample.openingTrace,...Object.fromEntries(Object.entries(sample.phases).map(([name,phase])=>[name,phase.trace]))}
  const phases={}
  for(const [name,measurement] of Object.entries(measurements)){
    if(!measurement?.path||!measurement.cpuProfile)throw new Error('需要 HICANVAS_STROKE_DIAG=1 的完整追踪。')
    const cpu=JSON.parse(await readFile(await scratchPath(measurement.cpuProfile),'utf8'))
    const trace=JSON.parse(await readFile(await scratchPath(measurement.path),'utf8'))
    phases[name]={cpu:summarizeStrokeCpu(cpu),timeline:summarizeStrokeTimeline(trace),metrics:measurement.metricsDelta}
  }
  results.push({renderer:sample.renderer,count:sample.count,repeat:sample.repeat,dom:sample.dom,phases})
}
const path=join(directory,'diagnosis.json');await writeFile(path,JSON.stringify({note:'CPU按命中次数归因，负timeDeltas只报告、不估算CPU毫秒；各线程事件时长可重叠，不相加当作墙钟时间；追踪FPS不作验收。',results},null,2))
for(const result of results){console.log(result.renderer,result.count,result.dom);for(const [name,phase] of Object.entries(result.phases))console.log(name,phase.cpu.buckets,phase.timeline.slices)}
console.log(path)
