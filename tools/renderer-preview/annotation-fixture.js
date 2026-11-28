import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

const quadrants = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><path fill="red" d="M0 0H100V70H0Z"/><path fill="lime" d="M100 0H200V70H100Z"/><path fill="blue" d="M0 70H100V140H0Z"/><path fill="yellow" d="M100 70H200V140H100Z"/></svg>'
// Entirely in-memory fixtures; no real asset, model or persistence port.
export function createAnnotationFixture(kind = 'drawing', zoom = 1) {
  if (!['drawing','static','fraction','edge','edge-over','area','area-over','web','slides'].includes(kind)) throw new Error('未知标注夹具。')
  if (![.5,1,2].includes(zoom)) throw new Error('未知标注夹具缩放。')
  const dimensions = { fraction:[330.25,140.5],edge:[4032,100],'edge-over':[4033,100],area:[3936,3936],'area-over':[3936,3937] }
  const [w,h] = dimensions[kind] || [200,140]
  const initial = createCanvasSnapshot(), commands = []
  const targetId = 'shape:annotation-target'
  if (kind === 'web') commands.push({ type:'create_shape',id:targetId,shapeType:'embed',x:200,y:220,props:{w,h,url:'data:text/html,'+encodeURIComponent('<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:rgb(28,72,112)}</style><body>Annotation web')},meta:{cowartHtmlDraft:true} })
  else if (kind === 'slides') commands.push({ type:'create_shape',id:targetId,shapeType:'frame',x:200,y:220,props:{w,h,name:'合成幻灯片'},meta:{cowartAiSlides:true} })
  else {
    commands.push({ type:'put',record:{id:'asset:annotation-image',typeName:'asset',type:'image',meta:{},props:{name:'Synthetic quadrants',src:'data:image/svg+xml,'+encodeURIComponent(quadrants),w:200,h:140,mimeType:'image/svg+xml',isAnimated:false}} })
    commands.push({type:'create_shape',id:targetId,shapeType:'image',x:kind==='fraction'?200.25:200,y:kind==='fraction'?220.5:220,props:{w,h,assetId:'asset:annotation-image'}})
  }
  if (kind === 'drawing') commands.push({type:'create_shape',id:'shape:annotation-unrelated',shapeType:'geo',x:1000,y:450,props:{w:80,h:80,dash:'solid',color:'blue'}})
  if (kind === 'static') commands.push(
    {type:'create_shape',id:'shape:annotation-arrow',shapeType:'arrow',x:470,y:400,text:'标注 label',meta:{cowartAnnotationArrow:true},props:{start:{x:0,y:0},end:{x:-150,y:-100},bend:32,labelPosition:0,color:'red',labelColor:'red',dash:'draw'}},
    {type:'create_shape',id:'shape:annotation-text',shapeType:'text',x:570,y:420,text:'相关文字',meta:{cowartAnnotationText:true},props:{w:120,autoSize:false,color:'black'}})
  const snapshot = executeCanvasCommands(initial,commands).snapshot, shapes = Object.values(snapshot.store).filter(r=>r.typeName==='shape')
  return { snapshot, annotationFixture:kind, annotationTarget:targetId, count:shapes.length, counts:Object.fromEntries([...new Set(shapes.map(s=>s.type))].map(type=>[type,shapes.filter(s=>s.type===type).length])), assetCount:Object.values(snapshot.store).filter(r=>r.typeName==='asset').length, viewState:{currentPageId:Object.values(snapshot.store).find(r=>r.typeName==='page').id,camera:{x:0,y:0,z:zoom}} }
}
