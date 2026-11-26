import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {CHILD_ASSETS} from '../content-channel/index.js'

const directory=new URL('../content-channel/',import.meta.url)
const compiled=new Map()
let assets
const bundles={
  'offline-slides.js':{format:'iife',files:['offline-slides.js','slides.js','content-policy.js','protocol.js']},
  'edit.js':{files:['edit.js','dom-editor.js','edit-protocol.js']},
  'capture.js':{dependency:'html2canvas',files:['capture.js','capture-realm.js','capture-render.js','capture-clip-fix.js','capture-protocol.js']},
  'film-export.js':{dependency:'mediabunny',files:['film-export.js','film-export-protocol.js','film-frame-ready.js','film-video-frames.js','film-export-clock.js','film-deadline.js','film-time.js'],external:['./capture.js']},
}
async function bundledAsset(name,source){
  const config=bundles[name],label=name.slice(0,-3)+'-bundle'

  // Desktop staging publishes only the finished fixed asset. This branch must
  // never resolve esbuild or any source dependency in the installed application.
  if(source.toString('utf8',0,100).startsWith('// hiCanvas '+label+' sha256:'))return source
  const version=config.dependency?JSON.parse(await readFile(new URL('../node_modules/'+config.dependency+'/package.json',import.meta.url),'utf8')).version:''
  const hash=createHash('sha256').update(name).update(version)
  for(const name of config.files)hash.update(name).update(await readFile(new URL(name,directory)))
  const key=hash.digest('hex')
  if(!compiled.has(key))compiled.set(key,(async()=>{
    // Source/dev only; esbuild is already a locked dependency. Builds are local
    // and deterministic: no network access, timestamps or absolute source paths.
    const {build}=await import('esbuild')
    const result=await build({entryPoints:[fileURLToPath(new URL(name,directory))],bundle:true,external:config.external,write:false,platform:'browser',format:config.format||'esm',target:'es2022',minify:true,legalComments:'inline',logLevel:'silent'})
    return Buffer.concat([Buffer.from('// hiCanvas '+label+' sha256:'+key+'\n'),result.outputFiles[0].contents])
  })())
  return compiled.get(key)
}
export function readChannelAssets(){
  // Only names from the immutable project whitelist reach filesystem reads.
  return assets ||= Promise.all(CHILD_ASSETS.map(async name=>{
    const source=await readFile(new URL(name,directory))
    return [name,bundles[name]?await bundledAsset(name,source):source]
  })).catch(error=>{assets=undefined;throw error})
}
