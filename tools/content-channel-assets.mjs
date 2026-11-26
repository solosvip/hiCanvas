import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {readChannelAssets} from '../server/content-channel-assets.mjs'

export async function stageContentChannelAssets(stage){
  await mkdir(join(stage,'content-channel'),{recursive:true})
  for(const [name,bytes] of await readChannelAssets())await writeFile(join(stage,'content-channel',name),bytes)
}
