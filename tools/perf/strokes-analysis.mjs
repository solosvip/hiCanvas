// CPU attribution uses sample hits: observed profiles contain negative time
// deltas, so we do not convert hit counts to CPU milliseconds.
export function summarizeStrokeCpu(profile){
  const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map(),self=new Map()
  for(const node of profile.nodes)for(const child of node.children||[])parents.set(child,node.id)
  const buckets={outline:0,pathString:0,gc:0,other:0},inclusive=new Map()
  for(const [i,id] of (profile.samples||[]).entries()){
    const hits=1
    if(!nodes.has(id))throw new Error('无效CPU采样。')
    const stack=[],seen=new Set()
    for(let at=id;at!==undefined;at=parents.get(at)){
      if(seen.has(at))throw new Error('CPU调用栈循环。')
      seen.add(at);const frame=nodes.get(at).callFrame
      const key=`${frame.functionName||'(anonymous)'} @ ${frame.url}:${frame.lineNumber+1}`
      stack.push(frame);inclusive.set(key,(inclusive.get(key)||0)+hits)
    }
    const leaf=stack[0],key=`${leaf.functionName||'(anonymous)'} @ ${leaf.url}:${leaf.lineNumber+1}`
    self.set(key,(self.get(key)||0)+hits)
    const kind=stack.some(f=>f.functionName==='getStrokeGeometry')?'outline':stack.some(f=>f.functionName==='strokePath')?'pathString':leaf.functionName==='(garbage collector)'?'gc':'other'
    buckets[kind]+=hits
  }
  const ranked=map=>[...map].map(([frame,hits])=>({frame,hits})).sort((a,b)=>b.hits-a.hits).slice(0,18)
  return {durationMs:(profile.endTime-profile.startTime)/1000,sampledHits:(profile.samples||[]).length,negativeDeltas:(profile.timeDeltas||[]).filter(n=>n<0).length,buckets,self:ranked(self),inclusive:ranked(inclusive)}
}
export function summarizeStrokeTimeline(trace){
  const durations=new Map(),counts=new Map()
  for(const event of trace.traceEvents){
    counts.set(event.name,(counts.get(event.name)||0)+1)
    if(event.ph==='X'&&Number.isFinite(event.dur)&&event.dur>=0)durations.set(event.name,(durations.get(event.name)||0)+event.dur/1000)
  }
  const ranked=map=>[...map].sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value})).slice(0,30)
  const names=['UpdateLayoutTree','Layout','PrePaint','Paint','RasterTask','RasterizePaint','Layerize','CompositeLayers','DrawFrame','ActivateLayerTree']
  return {slices:Object.fromEntries(names.map(name=>[name,{ms:durations.get(name)||0,count:counts.get(name)||0}])),largestSlices:ranked(durations),mostFrequent:ranked(counts)}
}
