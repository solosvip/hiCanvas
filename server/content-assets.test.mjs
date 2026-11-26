import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createContentAssets} from './content-assets.mjs'

async function fixture(t){
  const scratch=fileURLToPath(new URL('../.scratch/',import.meta.url));await mkdir(scratch,{recursive:true})
  const root=await mkdtemp(join(scratch,'content-assets-')),canvasDir=join(root,'canvas'),assets=join(canvasDir,'assets')
  await mkdir(assets,{recursive:true})
  t.after(()=>rm(root,{recursive:true,force:true}))
  return {root,canvasDir,assets,workspace:{async storageFor(){return {canvasDir}}}}
}
const context={parentOrigin:'http://127.0.0.1:43218',conversationId:'legacy',sourceUrl:'/assets/page.html'}
test('资源快照有单文件、总字节与数量上限，公开脚本不经本机代理',async t=>{
  const {workspace,assets}=await fixture(t)
  await writeFile(join(assets,'one.js'),'12345');await writeFile(join(assets,'two.js'),'67890')
  const html='<script src="one.js"></script><script src="two.js"></script>'
  for(const limits of [{maxFileBytes:4},{maxBytes:Buffer.byteLength(html)+9},{maxFiles:1}])await assert.rejects(createContentAssets(workspace,limits)(html,context),e=>e.status===413)
  const external='<script src="https://public.example/library.js"></script>'
  const prepared=await createContentAssets(workspace)(external,context)
  assert.equal(prepared.files.size,1)
  assert.equal(prepared.files.get(prepared.path).bytes.toString(),external)
})
test('资源目录符号链接不可越出画板；快照不随磁盘内容变化',async t=>{
  const {workspace,assets,root,canvasDir}=await fixture(t)
  await writeFile(join(assets,'one.js'),'original')
  const prepared=await createContentAssets(workspace)('<script src="one.js"></script>',context)
  await writeFile(join(assets,'one.js'),'changed')
  assert.equal(prepared.files.get('/assets/one.js').bytes.toString(),'original')
  const external=join(root,'external');await mkdir(external);await writeFile(join(external,'secret.js'),'secret')
  await mkdir(join(canvasDir,'pages'))
  await symlink(external,join(canvasDir,'pages','escape'))
  await mkdir(join(external,'assets'));await writeFile(join(external,'assets','secret.js'),'secret')
  await assert.rejects(createContentAssets(workspace)('<script src="/page-assets/escape/secret.js"></script>',context),e=>e.status===403)
})
test('普通导航链接不登记资源；重复发现去重并在读取之前限制授权数量',async t=>{
  const {workspace}=await fixture(t)
  const html='<a href="/">home</a><a href="/about/">about</a>'
  assert.equal((await createContentAssets(workspace)(html,context)).files.size,1)
  const repeated='<img src="/assets/missing.png">'.repeat(1000)
  await assert.rejects(createContentAssets(workspace,{maxFiles:1})(repeated,context),e=>e.code==='ENOENT')
  await assert.rejects(createContentAssets(workspace,{maxFiles:1})('<img src="/assets/one.png"><img src="/assets/two.png">',context),e=>e.status===413)
})
