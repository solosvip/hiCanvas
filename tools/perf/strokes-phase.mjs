import {performance} from 'node:perf_hooks'
import {setTimeout as delay} from 'node:timers/promises'
import {benchmarkViewport,summarizeFrames,phaseChanged} from './config.mjs'
import {startFrames,stopFrames} from './frame-probe.mjs'
import * as probe from './strokes-probe.mjs'

export async function selected(evaluate,fixture){
  const end=performance.now()+5000
  while(performance.now()<end){if((await evaluate(probe.inspectState,fixture)).selected)return;await delay(20)}
  throw new Error(`原生指针未选中笔迹：${fixture.targetId}`)
}
export function assertStrokeStart(fixture,state){
  if(fixture.snapping&&!state.snapping)throw new Error('吸附专用拖动没有开启吸附，拒绝空测。')
  if(['x','y','z'].some(key=>Math.abs(state.camera[key]-fixture.camera[key])>1e-8))throw new Error('笔迹阶段起始视角不符。')
  if(state.selectedIds.length!==1||state.selectedIds[0]!==fixture.targetId)throw new Error('两版笔迹阶段必须仅选中同一目标。')
}
export function assertStrokeChange(name,before,after,zoomRange){
  if(JSON.stringify(before.shape.props)!==JSON.stringify(after.shape.props)||before.shape.rotation!==after.shape.rotation)throw new Error('笔迹被变形，拒绝当作拖动性能。')
  if(name!=='drag'&&(before.shape.x!==after.shape.x||before.shape.y!==after.shape.y))throw new Error('视角操作意外移动笔迹。')
  if(!phaseChanged(name,before,after,zoomRange))throw new Error(`${name}未改变预期状态，拒绝空转帧率。`)
}
export async function measureStrokePhase({name,fixture,contents,paints,evaluate,durationMs,startTrace}){
  const input=event=>contents.sendInputEvent(event)
  const move=(x,y,extra={})=>input({type:'mouseMove',x:Math.round(x),y:Math.round(y),...extra})
  const button=(type,point,button='left')=>input({type,x:Math.round(point.x),y:Math.round(point.y),button,clickCount:1})
  await delay(250)
  await evaluate(probe.resetCamera,{camera:fixture.camera})
  const before=await evaluate(probe.inspectState,fixture)
  assertStrokeStart(fixture,before)
  const point=name==='drag'?before.point:{x:benchmarkViewport.width/2,y:benchmarkViewport.height/2}
  move(point.x,point.y)
  if(name==='drag'){button('mouseDown',point);button('mouseUp',point);await selected(evaluate,fixture)}
  const stopTrace=await startTrace?.(),start=performance.now()
  let frames,end,inputs=0,nextInput=start,lastWheel=0
  try{
    await evaluate(startFrames)
    if(name!=='zoom')button('mouseDown',point,name==='pan'?'middle':'left')
    while(performance.now()-start<durationMs){
      const progress=Math.min(1,(performance.now()-start)/durationMs)
      if(name==='zoom'){
        const wheel=12*Math.sin(progress*Math.PI*4)+6*progress
        input({type:'mouseWheel',x:point.x,y:point.y,deltaX:0,deltaY:wheel-lastWheel,modifiers:['control'],canScroll:true});lastWheel=wheel
      }else move(point.x+progress*100,point.y+Math.sin(progress*Math.PI/2)*70,{button:name==='pan'?'middle':'left',modifiers:[name==='pan'?'middleButtonDown':'leftButtonDown']})
      inputs++;nextInput+=1000/60
      if(nextInput<performance.now())nextInput=performance.now()+1000/60
      await delay(Math.max(1,nextInput-performance.now()))
    }
  }finally{
    try{if(name!=='zoom')button('mouseUp',{x:point.x+100,y:point.y+70},name==='pan'?'middle':'left')}
    finally{frames=await evaluate(stopFrames);end=performance.now()}
  }
  const trace=await stopTrace?.(),after=await evaluate(probe.inspectState,fixture)
  assertStrokeChange(name,before,after,frames.zoomRange)
  const result={raf:summarizeFrames(frames.times,frames.start,frames.end),paint:summarizeFrames(paints,start,end),zoomRange:frames.zoomRange,inputEvents:inputs,before,after,trace}
  if(result.raf.frames<2||result.paint.frames<2)throw new Error(`${name}没有有效绘制帧。`)
  return result
}
