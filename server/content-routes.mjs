import {prepareOfflineSlides} from './slides-export.mjs'
import {createContentHost} from './content-host.mjs'
import {createContentAssets} from './content-assets.mjs'
import {jsonBody} from './local-request.mjs'
import {sendJson} from './protocol.mjs'
import {httpError} from './file-lock.mjs'

// Called only after the main service's unchanged read AND client guards.
export function createContentRoutes(workspace,enabled=process.env.HICANVAS_CONTENT_HOST==='1') {
  const host=enabled?createContentHost({prepare:createContentAssets(workspace)}):null
  return {
    info:()=>host?host.info():{enabled:false},
    close:()=>host?.close(),
    async handle(req,res){
      if(!host)throw httpError('内容宿主开关未开启。',404)
      const body=await jsonBody(req)
      if(new URL(req.url,'http://localhost').pathname==='/api/content-host/slides-export'){
        if(req.method!=='POST')throw httpError('方法不支持。',405)
        return sendJson(res,200,await prepareOfflineSlides(workspace,{...body,parentOrigin:`http://${req.headers.host}`}))
      }
      if(req.method==='POST')return sendJson(res,201,await host.register({...body,parentOrigin:`http://${req.headers.host}`}))
      if(req.method==='DELETE'){host.revoke(body.id,body.revokeToken);return sendJson(res,200,{ok:true})}
      if(req.method==='PUT')return sendJson(res,200,host.renew(body.id,body.revokeToken))
      throw httpError('方法不支持。',405)
    }
  }
}
