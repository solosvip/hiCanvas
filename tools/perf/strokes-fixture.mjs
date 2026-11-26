import {getIndexAbove} from '@tldraw/utils'
import {createCanvasSnapshot} from '../../model/index.js'
import {createFixture} from './fixture.mjs'
import {addStrokeLoad,strokeProps,strokeSegment} from '../renderer-preview/stroke-fixtures.js'
import {benchmarkViewport} from './config.mjs'

export const strokeCases=Object.freeze([500,1000,2000,5000])
const sizes=['s','m','l','xl']
export function createStrokeFixture(count,initial){
  if(!strokeCases.includes(count))throw new Error('笔迹样本需要500／2000／5000笔迹，或1000个元素的混合样本。')
  if(count===1000){
    const fixture=addStrokeLoad(createFixture(500,initial))
    return target({...fixture,caseName:'500 base + 500 strokes',strokeCount:500},'shape:stroke-load-499',23*128,22*104)
  }
  const snapshot=createCanvasSnapshot(initial),store=snapshot.store
  const pageId=Object.values(store).find(record=>record.typeName==='page').id
  const columns=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns)
  let index='a0'
  const wave=Array.from({length:129},(_,j)=>({x:j*.75,y:36+Math.sin(j/8)*25,z:.2+j/160}))
  for(let i=0;i<count;i++){
    const id=`shape:stroke-load-${i}`,type=i%2?'draw':'highlight'
    store[id]={id,typeName:'shape',type,x:i%columns*128,y:Math.floor(i/columns)*104,rotation:0,index,parentId:pageId,isLocked:false,opacity:1,meta:{},props:strokeProps(type,{size:sizes[i%4],isPen:i%3===0,segments:[strokeSegment(wave)]})}
    index=getIndexAbove(index)
  }
  const width=columns*128,height=rows*104,z=Math.max(.1,Math.min((benchmarkViewport.width-160)/width,(benchmarkViewport.height-160)/height))
  const camera={x:(benchmarkViewport.width/z-width)/2,y:(benchmarkViewport.height/z-height)/2,z}
  return target({snapshot,viewState:{version:1,currentPageId:pageId,camera},count,counts:{image:0,text:0,geo:0,draw:count/2,highlight:count/2},assetCount:0,strokeCount:count,caseName:`${count} strokes`,viewport:benchmarkViewport},`shape:stroke-load-${count-1}`,width,height)
}
function target(fixture,id,width,height){
  // One topmost diagonal has a clear interior at every fitted zoom. Its center
  // stays away from selection handles during native drag measurements.
  const record=fixture.snapshot.store[id]
  record.x=width/2-480;record.y=height/2-360
  record.props={...record.props,size:'xl',isPen:false,segments:[strokeSegment(Array.from({length:129},(_,j)=>({x:j*7.5,y:j*5.625,z:.5})))]}
  return {...fixture,targetId:id,targetPoint:{x:record.x+480,y:record.y+360}}
}
