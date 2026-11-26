import {createCanvasSnapshot,createCanvasStore} from '../../model/index.js'
import {mountCanvasRenderer,loadGeneratedFrame} from '../../renderer/index.js'

// Synthetic renderer host. Playback commands use the same public frame ability
// as the legacy toolbar; no child DOM is read in the isolated case.
window.startChannelPreview=async html=>{
  const snapshot=createCanvasSnapshot(),store=createCanvasStore(),frames=[],statuses=[]
  const pageId=Object.values(snapshot.store).find(record=>record.typeName==='page').id
  for(let i=0;i<3;i++)snapshot.store['shape:channel-'+i]={id:'shape:channel-'+i,typeName:'shape',type:'embed',parentId:pageId,index:'a'+i,x:20+i*350,y:20,rotation:0,opacity:1,isLocked:false,props:{w:320,h:180,url:'data:text/html,'+encodeURIComponent(html)},meta:{cowartHtmlDraft:true,cowartFilm:i===0}}
  store.loadStoreSnapshot(snapshot)
  let requests=0,channel,controller,loadVersion=0
  const fetcher=(url,options)=>{if(url==='/api/health')requests++;return fetch(url,options)}
  const status=value=>{
    statuses.push(value)
    document.querySelector('#status').textContent=JSON.stringify(value)
    for(const button of document.querySelectorAll('button'))button.disabled=!value.ready
    document.querySelector('input').disabled=!value.ready
  }
  const renderer=mountCanvasRenderer(document.querySelector('#canvas'),{store,pageId,loadGeneratedFrame:async(...args)=>{
    const frame=await loadGeneratedFrame(args[0],{...args[1],fetcher});frames.push(frame)
    if(!frame.bind)return frame
    return {...frame,bind(iframe,options){
      const bound=frame.bind(iframe,options)
      if(options.film){loadVersion++;channel=bound;controller?.dispose();controller=channel.attachFilmController({onStatus:status})}
      return bound
    }}
  }})
  const controls={play:()=>controller.command('play'),pause:()=>controller.command('pause'),mute:()=>controller.command('mute',true)}
  for(const [id,command] of Object.entries(controls))document.querySelector('#'+id).onclick=command
  document.querySelector('input').oninput=event=>controller.command('seek',Number(event.target.value))
  window.__channelSmoke={getState:()=>({requests,loadVersion,status:statuses.at(-1),count:frames.length,urls:[...document.querySelectorAll('iframe')].map(frame=>frame.src)}),
    reload(){const frame=document.querySelector('iframe');frame.src=frame.src},
    async unmount(){controller?.dispose();renderer.unmount();await Promise.all(frames.map(frame=>frame.dispose()))},
  }
}
