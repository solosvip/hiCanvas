import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,rm,readdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {prepareOfflineSlides} from './slides-export.mjs'
import {contentSandbox,isolatedContentSandbox,CONTENT_CAPABILITIES} from '../content-channel/content-policy.js'

async function fixture(t){
  const directory=await mkdtemp(fileURLToPath(new URL('../.scratch/slides-export-',import.meta.url))),assets=join(directory,'assets');await mkdir(assets)
  t.after(()=>rm(directory,{recursive:true,force:true}))
  return {directory,assets,workspace:{storageFor:async()=>({canvasDir:directory})}}
}
const context={parentOrigin:'http://127.0.0.1:43385',conversationId:'legacy'}
test('离线封装本画板CSS、脚本及递归资源，外部在线引用原样保留并列清单',async t=>{
  const {workspace,assets}=await fixture(t)
  await writeFile(join(assets,'pixel.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(join(assets,'theme.css'),'@import "nested.css";body{background:url(pixel.svg)}')
  await writeFile(join(assets,'nested.css'),'body{color:red}')
  await writeFile(join(assets,'main.js'),'import "./nested.js";window.localLoaded=true')
  await writeFile(join(assets,'nested.js'),'window.nestedLoaded=true')
  const html='<link rel="stylesheet" href="http://127.0.0.1:43385/assets/theme.css"><script type="module" src="main.js"></script><script src="https://cdn.example.invalid/online.js"></script><svg><image xlink:href="pixel.svg"/></svg>'
  const result=await prepareOfflineSlides(workspace,{...context,pages:[{html,sourceUrl:'/assets/page.html'}]})
  assert.deepEqual(result.externalResources,['https://cdn.example.invalid/online.js'])
  assert.ok(result.pages[0].includes('https://cdn.example.invalid/online.js'))
  assert.ok(result.pages[0].includes('data:text/css;base64,'))
  assert.match(result.pages[0],/xlink:href="data:image\/svg\+xml;base64,/)
  const script=result.pages[0].match(/src="data:text\/javascript;base64,([^"]+)"/)[1]
  assert.match(Buffer.from(script,'base64').toString(),/import "data:text\/javascript;base64,/)
  assert.doesNotMatch(result.pages[0],/127\.0\.0\.1|cowart\.local/)
  assert.match(result.playerScript,/hiCanvas offline-slides-bundle sha256:/)
})
test('后页缺资源、跨画板或循环依赖明确失败，预检不留下任何导出目录',async t=>{
  const {workspace,assets,directory}=await fixture(t)
  await assert.rejects(prepareOfflineSlides(workspace,{...context,pages:[{html:'<p>first</p>'},{html:'<img src="/assets/missing.svg">'}]}),/ENOENT/)
  await assert.rejects(prepareOfflineSlides(workspace,{...context,pages:[{html:'<img src="/c/other/assets/image.svg">'}]}),/本画板/)
  await writeFile(join(assets,'cycle.css'),'@import "cycle.css";')
  await assert.rejects(prepareOfflineSlides(workspace,{...context,pages:[{html:'<link href="/assets/cycle.css">'}]}),/循环/)
  assert.deepEqual(await readdir(directory),['assets'])
})
test('应用与离线的脚本、表单、弹窗及网络规则相同，只有来源隔离方式不同',()=>{
  assert.deepEqual(contentSandbox().split(' '),CONTENT_CAPABILITIES)
  assert.deepEqual(isolatedContentSandbox(`http://${'a'.repeat(48)}.localhost:43386`,{port:43386,parentOrigin:context.parentOrigin}).split(' ').filter(value=>value!=='allow-same-origin'),CONTENT_CAPABILITIES)
  assert.ok(!contentSandbox().includes('allow-same-origin'))
})
test('来源权限构造拒绝画板地址、伪造随机域、错误端口与缺失父来源',()=>{
  const valid=`http://${'a'.repeat(48)}.localhost:43386/document.html`,options={port:43386,parentOrigin:context.parentOrigin}
  for(const value of [context.parentOrigin,'http://localhost:43386','http://attacker.localhost:43386',valid.replace('.localhost:', '.localhost.attacker.invalid:'),valid.replace('43386','43387'),valid.replace('http:', 'https:'),valid.replace('http://','http://user@')])assert.throws(()=>isolatedContentSandbox(value,options),/来源无效/,value)
  for(const invalid of [{},{port:43386},{port:'43386',parentOrigin:context.parentOrigin},{...options,parentOrigin:valid},{...options,parentOrigin:'https://external.invalid'}])assert.throws(()=>isolatedContentSandbox(valid,invalid),/来源无效/)
})
test('正文引语、textarea里的标签与JS字符串不当作模块；外部base保持原解析',async t=>{
  const {workspace}=await fixture(t)
  const prose='<p>A note from "Alice"</p><textarea><img src="missing.svg"></textarea><script>const text=\'from "Nobody"\'</script>'
  assert.ok((await prepareOfflineSlides(workspace,{...context,pages:[{html:prose}]})).pages[0].endsWith(prose))
  const html='<base href="https://cdn.example.invalid/deck/"><img src="logo.png">'
  const result=await prepareOfflineSlides(workspace,{...context,pages:[{html}]})
  assert.ok(result.pages[0].endsWith(html))
  assert.deepEqual(result.externalResources,['https://cdn.example.invalid/deck/','https://cdn.example.invalid/deck/logo.png'])
})
test('同一大资源重复内联及无环分叉在分配超限产物前失败',async t=>{
  const {workspace,assets,directory}=await fixture(t)
  await writeFile(join(assets,'large.png'),Buffer.alloc(9*1024*1024))
  await writeFile(join(assets,'branch.css'),'body{background:url(large.png)}')
  for(const html of ['<img src="large.png">'.repeat(3),'<link href="branch.css">'.repeat(3)]){
    await assert.rejects(prepareOfflineSlides(workspace,{...context,pages:[{html:'<p>first</p>'},{html,sourceUrl:'/assets/page.html'}]}),error=>error.status===413&&/展开/.test(error.message))
  }
  assert.deepEqual(await readdir(directory),['assets'])
})
test('外部base不改变绝对本地资源的身份，本地base目录本身不当成文件',async t=>{
  const {workspace,assets}=await fixture(t)
  await writeFile(join(assets,'pixel.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
  for(const html of ['<base href="https://cdn.example.invalid/"><img src="http://127.0.0.1:43385/assets/pixel.svg">','<base href="/assets/"><img src="pixel.svg">']){
    const result=await prepareOfflineSlides(workspace,{...context,pages:[{html}]})
    assert.match(result.pages[0],/src="data:image\/svg\+xml;base64,/)
    assert.doesNotMatch(result.pages[0],/127\.0\.0\.1|cowart\.local/)
  }
})
