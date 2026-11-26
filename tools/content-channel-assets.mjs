import {cp,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {CHILD_ASSETS} from '../content-channel/index.js'

export async function stageContentChannelAssets(stage){
  await mkdir(join(stage,'content-channel'),{recursive:true})
  for(const name of CHILD_ASSETS)await cp(new URL('../content-channel/'+name,import.meta.url),join(stage,'content-channel',name))
}
