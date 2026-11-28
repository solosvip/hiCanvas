import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConversations } from './conversations.mjs'
import { createClipboardAssets } from './clipboard-assets.mjs'
import { MAX_CLIPBOARD_FILE_BYTES, MAX_CLIPBOARD_RESOURCE_BYTES, MAX_CLIPBOARD_FILES } from '../engine/index.js'

async function fixture(t) {
  const scratch = fileURLToPath(new URL('../.scratch/', import.meta.url))
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'clipboard-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = createConversations(root)
  const source = (await workspace.open({ title: '合成来源' })).id
  const target = (await workspace.open({ title: '合成目标' })).id
  const assets = await workspace.assetsDir(source)
  await mkdir(assets, { recursive: true })
  const base = `/c/${source}/assets/`
  const html = '<link rel="stylesheet" href="style.css"><script type="module" src="main.js"></script><img src="picture.png"><script src="https://public.example/lib.js"></script>'
  for (const [name, data] of Object.entries({ 'draft.html': html, 'style.css': 'body{background:url(picture.png)}', 'main.js': 'import "./dep.js"; import "external-lib"', 'dep.js': 'export const n=1', 'picture.png': Buffer.from([0, 1, 2, 3]) })) await writeFile(join(assets, name), data)
  const initial = await workspace.read(source)
  await workspace.submitCommands(source, initial.revision, 'fixture', () => [{ type: 'create_shape', id: 'shape:html', shapeType: 'embed', props: { w: 300, h: 200, url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` }, meta: { cowartHtmlDraft: true, cowartHtmlDraftAssetUrl: base + 'draft.html' } }])
  return { root, workspace, source, target, assets, base, api: createClipboardAssets(workspace) }
}
async function copy(f) {
  return f.api.copy(f.source, { ids: ['shape:html'], expectedRevision: (await f.workspace.read(f.source)).revision })
}
async function files(f) { try { return await readdir(await f.workspace.assetsDir(f.target)) } catch (e) { if (e.code === 'ENOENT') return []; throw e } }
const paste = async (f, content, extra = {}) => f.api.paste(f.target, { expectedRevision: (await f.workspace.read(f.target)).revision, commands: [{ type: 'paste_content', content, ...extra }] }, 'ui:synthetic')

test('内部网页自包含打包HTML/CSS/模块和共享图片，来源删除后可粘贴；一次撤销移除全部新记录但保留文件', async t => {
  const f = await fixture(t), content = await copy(f)
  assert.equal(content.resources.length, 5)
  assert.equal(content.resources.filter(r => r.url.endsWith('picture.png')).length, 1)
  await rm(f.assets, { recursive: true })
  const before = await f.workspace.read(f.target)
  const result = await paste(f, content)
  const root = result.snapshot.store[result.results[0].rootIds[0]]
  assert.ok(root.meta.cowartHtmlDraftAssetUrl.startsWith(`/c/${f.target}/assets/`))
  assert.ok(!root.meta.cowartHtmlDraftAssetUrl.includes(f.source))
  const saved = await files(f)
  assert.equal(saved.length, 5)
  const directory = await f.workspace.assetsDir(f.target)
  const texts = await Promise.all(saved.filter(n => /\.(html|css|js)$/.test(n)).map(n => readFile(join(directory, n), 'utf8')))
  for (const text of texts) assert.ok(!text.includes(f.base))
  for (const text of texts.filter(text => /url\(|import|stylesheet/.test(text))) assert.ok(text.includes(`/c/${f.target}/assets/`), text)
  assert.ok(texts.some(text => text.includes('import "external-lib"')))
  const inline = Buffer.from(root.props.url.split(',')[1], 'base64').toString()
  assert.match(inline, new RegExp(`/c/${f.target}/assets/`))
  assert.ok(inline.includes('https://public.example/lib.js'))
  await f.workspace.undo(f.target, result.revision, 'ui:synthetic')
  assert.deepEqual((await f.workspace.read(f.target)).snapshot, before.snapshot)
  assert.deepEqual(await files(f), saved)
})

test('资源缺失、跨板路径、目录穿越、重复引用和未引用附件整包拒绝，目标与文件均不变', async t => {
  const f = await fixture(t), valid = await copy(f), before = await f.workspace.read(f.target)
  const cases = [
    c => c.resources.pop(),
    c => { c.resources[0].url = `/c/${f.target}/assets/secret.png` },
    c => { c.resources[0].url = f.base + '%2Fsecret.png' },
    c => c.resources.push(c.resources[0]),
    c => c.resources.push({ url: f.base + 'extra.png', mimeType: 'image/png', data: 'AQID' }),
    c => { c.resources.find(r => r.url.endsWith('.html')).mimeType = 'image/png' },
  ]
  for (const change of cases) {
    const content = structuredClone(valid); change(content)
    await assert.rejects(paste(f, content))
    assert.deepEqual(await f.workspace.read(f.target), before)
    assert.deepEqual(await files(f), [])
  }
})

test('来源符号链接不能读出画板；同板引用缺文件不开始目标写入', async t => {
  const f = await fixture(t)
  const secret = join(f.root, 'secret.png'); await writeFile(secret, 'secret')
  await rm(join(f.assets, 'picture.png'))
  await symlink(secret, join(f.assets, 'picture.png'))
  await assert.rejects(copy(f), e => e.status === 403)
  await rm(join(f.assets, 'picture.png'))
  await assert.rejects(copy(f), e => e.code === 'ENOENT')
  assert.deepEqual(await files(f), [])
})

test('文件大小、总字节和发现数量超限都拒绝，目标没有记录或资源变化', async t => {
  const f = await fixture(t), before = await f.workspace.read(f.target)
  await writeFile(join(f.assets, 'picture.png'), Buffer.alloc(MAX_CLIPBOARD_FILE_BYTES + 1))
  await assert.rejects(copy(f), e => e.status === 413)
  await writeFile(join(f.assets, 'picture.png'), Buffer.alloc(MAX_CLIPBOARD_FILE_BYTES))
  await writeFile(join(f.assets, 'extra.png'), Buffer.alloc(MAX_CLIPBOARD_RESOURCE_BYTES - MAX_CLIPBOARD_FILE_BYTES))
  for (const html of ['<img src="picture.png"><img src="extra.png">', Array.from({ length: MAX_CLIPBOARD_FILES + 1 }, (_, i) => `<img src="${f.base}${i}.png">`).join('')]) {
    const state = await f.workspace.read(f.source)
    await f.workspace.submitCommands(f.source, state.revision, 'fixture', () => [{ type: 'update', id: 'shape:html', changes: { props: { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` } } }])
    await assert.rejects(copy(f), e => e.status === 413)
  }
  assert.deepEqual(await f.workspace.read(f.target), before)
  assert.deepEqual(await files(f), [])
})

test('来源服务地址改变也能粘贴；外部base不带偏本机引用，外网脚本仍保持原地址', async t => {
  const f = await fixture(t), sourceOrigin = 'http://127.0.0.1:49001'
  const html = `<base href="https://public.example/base/"><img src="${sourceOrigin}${f.base}picture.png"><script src="library.js"></script>`
  await writeFile(join(f.assets, 'draft.html'), html)
  const state = await f.workspace.read(f.source)
  await f.workspace.submitCommands(f.source, state.revision, 'fixture', () => [{ type: 'update', id: 'shape:html', changes: { props: { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` } } }])
  const content = await f.api.copy(f.source, { ids: ['shape:html'], expectedRevision: (await f.workspace.read(f.source)).revision, parentOrigin: sourceOrigin })
  const result = await f.api.paste(f.target, { expectedRevision: (await f.workspace.read(f.target)).revision, parentOrigin: 'http://127.0.0.1:49002', commands: [{ type: 'paste_content', content }] }, 'ui:test')
  const root = result.snapshot.store[result.results[0].rootIds[0]]
  const finalHtml = Buffer.from(root.props.url.split(',')[1], 'base64').toString()
  assert.ok(!finalHtml.includes('49001'))
  assert.ok(finalHtml.includes('https://public.example/base/library.js'))
  assert.match(finalHtml, /<base href="\/">/)
  assert.ok(finalHtml.includes(`/c/${f.target}/assets/`))
})

test('百分号HTML、百分号base64和本机目录base都能枚举并迁移嵌套图片', async t => {
  const f = await fixture(t)
  const html = `<base href="${f.base}"><img src="picture.png">100% 中文`
  for (const url of [`data:text/html,${encodeURIComponent(html)}`, `data:text/html;charset=utf-8;base64,${encodeURIComponent(Buffer.from(html).toString('base64'))}`]) {
    const state = await f.workspace.read(f.source)
    await f.workspace.submitCommands(f.source, state.revision, 'fixture', () => [{ type: 'update', id: 'shape:html', changes: { props: { url }, meta: { cowartHtmlDraftAssetUrl: '' } } }])
    const content = await copy(f)
    assert.equal(content.resources.length, 1)
    const result = await paste(f, content)
    const final = Buffer.from(result.snapshot.store[result.results[0].rootIds[0]].props.url.split(',')[1], 'base64').toString()
    assert.ok(final.includes(`/c/${f.target}/assets/`))
    assert.ok(!final.includes(f.source))
    assert.ok(final.includes('100% 中文'))
  }
})

test('HTML内联模块保留import-map的bare名称，不读取同名本机文件', async t => {
  const f = await fixture(t)
  const html = '<script type="importmap">{"imports":{"external-lib":"https://public.example/lib.js"}}</script><script type="module">import "external-lib"; import "./dep.js"</script>'
  await writeFile(join(f.assets, 'draft.html'), html)
  const content = await copy(f)
  assert.equal(content.resources.length, 5)
  const result = await paste(f, content)
  const saved = await files(f), dir = await f.workspace.assetsDir(f.target)
  const file = saved.find(name => name.endsWith('draft.html'))
  const text = await readFile(join(dir, file), 'utf8')
  assert.ok(text.includes('import "external-lib"'))
  assert.ok(text.includes('https://public.example/lib.js'))
  assert.ok(text.includes(`/c/${f.target}/assets/`))
  assert.ok(result.results[0].rootIds.length)
})

test('版本冲突在落盘前拒绝；写完资源后命令被拒清掉本次文件，已有文件不碰', async t => {
  const f = await fixture(t), content = await copy(f)
  await assert.rejects(f.api.paste(f.target, { expectedRevision: 'stale', commands: [{ type: 'paste_content', content }] }, 'ui:test'), e => e.status === 409)
  assert.deepEqual(await files(f), [])
  const dir = await f.workspace.assetsDir(f.target)
  await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'existing.png'), 'keep')
  const submit = f.workspace.submitCommands
  f.workspace.submitCommands = (id, revision, actor, prepare, options) => submit(id, revision, actor, prepare, { ...options, prepareResources: async (...args) => {
    await options.prepareResources(...args)
    assert.equal((await files(f)).length, 6, '故障注入在全部五份新文件写完之后')
    throw new Error('injected after files')
  } })
  const before = await f.workspace.read(f.target)
  await assert.rejects(paste(f, content), /injected after files/)
  assert.deepEqual(await files(f), ['existing.png'])
  assert.equal(await readFile(join(dir, 'existing.png'), 'utf8'), 'keep')
  assert.deepEqual(await f.workspace.read(f.target), before)
})
