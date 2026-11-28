import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { captureRecordBasis, getRecordDependencies, executeCanvasCommands } from '../engine/index.js'
import { createCanvasSnapshot } from '../model/index.js'
import { fixture } from './test-helpers.mjs'
import { rasterFiles } from '../tools/renderer-preview/image-fixtures.js'

const png = `data:image/png;base64,${rasterFiles.png.base64}`
const basisFor = (snapshot, commands) => captureRecordBasis(snapshot, getRecordDependencies(snapshot, commands))
async function setup(t) {
  const f = await fixture(t), { id } = await f.workspace.open({ title: '合成资源写前检查' }), query = `?conversation=${id}`
  const post = (path, body, actor = 'ui:resource') => f.api(path + query, 'POST', body, { 'x-hicanvas-actor': actor })
  const read = async () => (await f.api('/api/canvas' + query)).body
  const remote = async operations => {
    const reply = await post('/api/canvas/operations', { expectedRevision: (await read()).revision, operations }, 'remote:239')
    assert.equal(reply.status, 200, JSON.stringify(reply.body)); return reply.body
  }
  await remote([{ type: 'create_shape', id: 'shape:anchor', shapeType: 'frame' }, { type: 'create_shape', id: 'shape:other', shapeType: 'geo', x: 2000 }])
  const initial = await read(), pageId = Object.values(initial.snapshot.store).find(r => r.typeName === 'page').id
  const files = async () => readdir(await f.workspace.assetsDir(id)).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const intent = { type: 'media_import_target', pageId }
  const guard = { expectedRevision: initial.revision, intent, recordBasis: basisFor(initial.snapshot, [intent]) }
  return { ...f, id, read, post, remote, files, pageId, initial, guard }
}

test('真实HTTP：guard缺字段、未知意图、无凭证不能降级为旧上传', async t => {
  const f = await setup(t)
  for (const guard of [{ expectedRevision: f.initial.revision }, { ...f.guard, intent: { type: 'delete', ids: ['shape:other'] } }, { ...f.guard, recordBasis: null }]) {
    const reply = await f.post('/api/canvas/reference', { purpose: 'file-import-begin', fileCount: 1, ...guard })
    assert.notEqual(reply.status, 200, JSON.stringify(reply.body))
  }
  const raw = await f.post('/api/canvas/reference', { purpose: 'file-import', dataUrl: png, ...f.guard })
  assert.notEqual(raw.status, 200)
  assert.deepEqual(await f.files(), [])
})

test('真实HTTP：带条件上传跨无关版本成功，后续相关变化在写第二份前拒绝，取消只清本次文件', async t => {
  const f = await setup(t)
  const begun = await f.post('/api/canvas/reference', { purpose: 'file-import-begin', fileCount: 2, ...f.guard })
  assert.equal(begun.status, 200, JSON.stringify(begun.body))
  const importToken = begun.body.importToken
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 3000 } }])
  const first = await f.post('/api/canvas/reference', { purpose: 'file-import', importToken, dataUrl: png })
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal((await f.files()).length, 1)
  await f.remote([{ type: 'update', id: f.pageId, changes: { name: '已更名的目标画布' } }])
  const before = await f.read(), second = await f.post('/api/canvas/reference', { purpose: 'file-import', importToken, dataUrl: png })
  assert.equal(second.status, 409, JSON.stringify(second.body)); assert.equal((await f.files()).length, 1)
  assert.deepEqual(await f.read(), before)
  const aborted = await f.post('/api/canvas/reference', { purpose: 'file-import-abort', importToken })
  assert.equal(aborted.status, 200); assert.equal(aborted.body.removed, 1); assert.deepEqual(await f.files(), [])
})

for (const dryRun of [true, false]) test(`真实HTTP：图片${dryRun ? '预演' : '保存'}共用写前记录检查`, async t => {
  const f = await setup(t), args = { pageId: f.pageId, anchorShapeId: 'shape:anchor', avoidOverlap: false, dataUrl: png, expectedRevision: f.initial.revision, dryRun }
  const command = { type: 'insert_image', args, image: { src: '/synthetic.png', w: 1, h: 1, mimeType: 'image/png' } }
  args.recordBasis = basisFor(f.initial.snapshot, [command])
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 4000 } }])
  const before = await f.read(), okay = await f.post('/api/canvas/image', args)
  assert.equal(okay.status, 200, JSON.stringify(okay.body))
  assert.equal((await f.files()).length, dryRun ? 0 : 1)
  if (dryRun) assert.deepEqual(await f.read(), before)
  const count = (await f.files()).length
  await f.remote([{ type: 'update', id: 'shape:anchor', changes: { x: 100 } }])
  const current = await f.read(), rejected = await f.post('/api/canvas/image', args)
  assert.equal(rejected.status, 409, JSON.stringify(rejected.body))
  assert.equal((await f.files()).length, count); assert.deepEqual(await f.read(), current)
})

async function imageContent(f) {
  const upload = await f.post('/api/canvas/reference', { purpose: 'file-import', dataUrl: png })
  assert.equal(upload.status, 200)
  await f.remote([{ type: 'insert_image', args: { pageId: f.pageId, avoidOverlap: false }, image: { src: upload.body.src, w: 320, h: 180, mimeType: 'image/png' } }])
  const initial = await f.read(), image = Object.values(initial.snapshot.store).find(r => r.typeName === 'shape' && r.type === 'image')
  const intent = [{ type: 'copy_content', ids: [image.id] }]
  const copied = await f.post('/api/canvas/clipboard/copy', { ids: [image.id], expectedRevision: initial.revision, recordBasis: basisFor(initial.snapshot, intent) })
  assert.equal(copied.status, 200); assert.equal(copied.body.resources.length, 1)
  const commands = [{ type: 'paste_content', content: copied.body, parentId: 'shape:anchor', offset: { x: 30, y: 40 } }]
  return { initial, commands, recordBasis: basisFor(initial.snapshot, commands) }
}
for (const related of [false, true]) test(`真实HTTP：自包含图片粘贴${related ? '目标变化零新增文件' : '无关变化正常迁移资源'}`, async t => {
  const f = await setup(t), request = await imageContent(f), oldFiles = await f.files()
  await f.remote([{ type: 'update', id: related ? 'shape:anchor' : 'shape:other', changes: { x: 5555 } }])
  const before = await f.read(), reply = await f.post('/api/canvas/clipboard/paste', { expectedRevision: request.initial.revision, commands: request.commands, recordBasis: request.recordBasis })
  assert.equal(reply.status, related ? 409 : 200, JSON.stringify(reply.body))
  assert.equal((await f.files()).length, oldFiles.length + (related ? 0 : 1))
  if (related) assert.deepEqual(await f.read(), before)
  else {
    const shape = reply.body.snapshot.store[reply.body.results[0].rootIds[0]], asset = reply.body.snapshot.store[shape.props.assetId]
    assert.equal(shape.parentId, 'shape:anchor')
    const resource = await fetch(f.base + asset.props.src)
    assert.equal(resource.status, 200); assert.deepEqual(Buffer.from(await resource.arrayBuffer()), Buffer.from(rasterFiles.png.base64, 'base64'))
  }
})

for (const kind of ['image', 'paste']) test(`真实HTTP：${kind}写完资源后故障只回滚本次文件，不改文档或历史`, async t => {
  const f = await setup(t), prepared = kind === 'paste' ? await imageContent(f) : null
  const before = await f.read(), existing = await f.files(), submit = f.workspace.submitCommands
  let written = false
  f.workspace.submitCommands = (id, revision, actor, createCommands, options) => submit(id, revision, actor, createCommands, { ...options, prepareResources: async (...args) => {
    await options.prepareResources(...args)
    assert.equal((await f.files()).length, existing.length + 1)
    written = true; throw new Error('synthetic after resource write')
  } })
  const reply = await f.post(kind === 'image' ? '/api/canvas/image' : '/api/canvas/clipboard/paste', kind === 'image' ? { expectedRevision: before.revision, dataUrl: png, avoidOverlap: false } : { expectedRevision: before.revision, commands: prepared.commands, recordBasis: prepared.recordBasis })
  assert.equal(reply.status, 500); assert.equal(reply.body.error, '本机资料无法完整读取或保存；已保留原文件，请检查资料目录。')
  assert.equal(written, true); assert.deepEqual(await f.files(), existing); assert.deepEqual(await f.read(), before)
  const undo = await f.post('/api/canvas/undo', { expectedRevision: before.revision })
  assert.notEqual(undo.status, 200, '失败不消耗本人撤销历史')
})

test('真实HTTP：带条件上传配额不因冲突消耗，修订基线必须新申请凭证', async t => {
  const f = await setup(t), start = await f.post('/api/canvas/reference', { purpose: 'file-import-begin', fileCount: 1, ...f.guard })
  assert.equal(start.status, 200)
  await f.remote([{ type: 'update', id: f.pageId, changes: { name: 'Changed page' } }])
  for (let i = 0; i < 2; i++) {
    const reply = await f.post('/api/canvas/reference', { purpose: 'file-import', importToken: start.body.importToken, dataUrl: png })
    assert.equal(reply.status, 409); assert.deepEqual(await f.files(), [])
  }
  const current = await f.read(), fresh = { expectedRevision: current.revision, intent: f.guard.intent, recordBasis: basisFor(current.snapshot, [f.guard.intent]) }
  const next = await f.post('/api/canvas/reference', { purpose: 'file-import-begin', fileCount: 1, ...fresh })
  assert.equal(next.status, 200)
  const upload = await f.post('/api/canvas/reference', { purpose: 'file-import', importToken: next.body.importToken, dataUrl: png })
  assert.equal(upload.status, 200)
  for (const importToken of [start.body.importToken, next.body.importToken]) assert.equal((await f.post('/api/canvas/reference', { purpose: 'file-import-abort', importToken })).status, 200)
  assert.deepEqual(await f.files(), [])
})

for (const mode of ['invalid-placement', 'record-conflict']) test(`真实HTTP：沿用既有assetUrl的${mode}失败不删除资源或改变字节`, async t => {
  const f = await setup(t), uploaded = await f.post('/api/canvas/reference', { purpose: 'file-import', dataUrl: png })
  assert.equal(uploaded.status, 200)
  const initial = await f.read(), existing = await f.files()
  const args = { assetUrl: uploaded.body.src, expectedRevision: initial.revision, pageId: f.pageId, anchorShapeId: 'shape:anchor', avoidOverlap: false, matchAnchor: false, ...(mode === 'invalid-placement' && { displayWidth: 0 }) }
  args.recordBasis = basisFor(initial.snapshot, [{ type: 'insert_image', args, image: { src: uploaded.body.src, w: 320, h: 180, mimeType: 'image/png' } }])
  if (mode === 'record-conflict') await f.remote([{ type: 'update', id: 'shape:anchor', changes: { x: 123 } }])
  const before = await f.read(), reply = await f.post('/api/canvas/image', args)
  assert.equal(reply.status, mode === 'record-conflict' ? 409 : 400, JSON.stringify(reply.body))
  assert.deepEqual(await f.read(), before); assert.deepEqual(await f.files(), existing)
  const preserved = await fetch(f.base + uploaded.body.src)
  assert.equal(preserved.status, 200); assert.deepEqual(Buffer.from(await preserved.arrayBuffer()), Buffer.from(rasterFiles.png.base64, 'base64'))
})

test('真实HTTP：替换图片占位框不执行避障，远处对象变化仍成功且标注保留', async t => {
  const f = await setup(t)
  await f.remote([{ type: 'update', id: 'shape:anchor', changes: { meta: { cowartAiImageHolder: true } } }, { type: 'create_shape', id: 'shape:annotation', shapeType: 'geo', parentId: 'shape:anchor', x: 10, y: 20 }])
  const initial = await f.read(), args = { expectedRevision: initial.revision, anchorShapeId: 'shape:anchor', dataUrl: png }
  args.recordBasis = basisFor(initial.snapshot, [{ type: 'insert_image', args, image: { src: '/synthetic.png', w: 320, h: 180, mimeType: 'image/png' } }])
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 5678 } }])
  const reply = await f.post('/api/canvas/image', args)
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  const saved = await f.read()
  assert.equal(saved.snapshot.store['shape:anchor'], undefined); assert.equal(saved.snapshot.store['shape:annotation'].parentId, f.pageId)
  assert.equal(saved.snapshot.store['shape:other'].x, 5678)
})

test('真实HTTP：组内占位框替换补回图片，不因误算解组拒绝远处变化', async t => {
  const f = await setup(t)
  await f.remote([
    { type: 'create_shape', id: 'shape:group', shapeType: 'group' },
    { type: 'update', id: 'shape:anchor', changes: { parentId: 'shape:group', meta: { cowartAiImageHolder: true } } },
    { type: 'create_shape', id: 'shape:peer', shapeType: 'geo', parentId: 'shape:group', x: 400 },
    { type: 'create_shape', id: 'shape:annotation', shapeType: 'geo', parentId: 'shape:anchor', x: 10, y: 20 },
  ])
  const initial = await f.read(), args = { expectedRevision: initial.revision, anchorShapeId: 'shape:anchor', dataUrl: png }
  args.recordBasis = basisFor(initial.snapshot, [{ type: 'insert_image', args, image: { src: '/synthetic.png', w: 320, h: 180, mimeType: 'image/png' } }])
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 5678 } }])
  const reply = await f.post('/api/canvas/image', args)
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  const saved = await f.read(), members = Object.values(saved.snapshot.store).filter(r => r.typeName === 'shape' && r.parentId === 'shape:group')
  assert.equal(saved.snapshot.store['shape:anchor'], undefined); assert.equal(saved.snapshot.store['shape:group'].type, 'group')
  assert.equal(members.length, 3); assert.ok(members.some(r => r.type === 'image')); assert.ok(members.some(r => r.id === 'shape:peer'))
  assert.deepEqual(saved.snapshot.store['shape:group'], initial.snapshot.store['shape:group'])
  const annotation = saved.snapshot.store['shape:annotation']
  assert.equal(annotation.parentId, 'shape:group'); assert.deepEqual([annotation.x, annotation.y], [10, 20])
  assert.deepEqual(annotation.props, initial.snapshot.store['shape:annotation'].props)
  assert.equal(saved.snapshot.store['shape:other'].x, 5678)
})

test('真实HTTP：占位框替换期间直接标注变化仍拒绝且零新增文件', async t => {
  const f = await setup(t)
  await f.remote([{ type: 'update', id: 'shape:anchor', changes: { meta: { cowartAiImageHolder: true } } }, { type: 'create_shape', id: 'shape:annotation', shapeType: 'geo', parentId: 'shape:anchor' }])
  const initial = await f.read(), args = { expectedRevision: initial.revision, anchorShapeId: 'shape:anchor', dataUrl: png }
  args.recordBasis = basisFor(initial.snapshot, [{ type: 'insert_image', args, image: { src: '/synthetic.png', w: 320, h: 180, mimeType: 'image/png' } }])
  await f.remote([{ type: 'update', id: 'shape:annotation', changes: { x: 123 } }])
  const before = await f.read(), files = await f.files(), reply = await f.post('/api/canvas/image', args)
  assert.equal(reply.status, 409, JSON.stringify(reply.body)); assert.deepEqual(await f.read(), before); assert.deepEqual(await f.files(), files)
})

test('真实HTTP：标注新层序在锁内分配，上方同级改index不阻止占位框替换', async t => {
  const f = await setup(t)
  await f.remote([
    { type: 'update', id: 'shape:anchor', changes: { index: 'a1', meta: { cowartAiImageHolder: true } } },
    { type: 'update', id: 'shape:other', changes: { index: 'a2' } },
    { type: 'create_shape', id: 'shape:annotation', shapeType: 'geo', parentId: 'shape:anchor' },
  ])
  const initial = await f.read(), args = { expectedRevision: initial.revision, anchorShapeId: 'shape:anchor', dataUrl: png }
  args.recordBasis = basisFor(initial.snapshot, [{ type: 'insert_image', args, image: { src: '/synthetic.png', w: 320, h: 180, mimeType: 'image/png' } }])
  await f.remote([{ type: 'update', id: 'shape:other', changes: { index: 'a4' } }])
  const reply = await f.post('/api/canvas/image', args)
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  const saved = await f.read(), siblings = Object.values(saved.snapshot.store).filter(r => r.typeName === 'shape' && r.parentId === f.pageId)
  const image = siblings.find(r => r.type === 'image'), annotation = saved.snapshot.store['shape:annotation'], above = saved.snapshot.store['shape:other']
  assert.equal(above.index, 'a4'); assert.equal(annotation.parentId, f.pageId)
  assert.ok(image.index < annotation.index && annotation.index < above.index)
  assert.equal(new Set(siblings.map(r => r.index)).size, siblings.length)
})

async function singleGroupHolder(t, nested) {
  const f = await setup(t)
  await f.remote([
    ...(nested ? [{ type: 'create_shape', id: 'shape:outer', shapeType: 'group' }] : []),
    { type: 'create_shape', id: 'shape:single', shapeType: 'group', ...(nested && { parentId: 'shape:outer' }) },
    { type: 'update', id: 'shape:anchor', changes: { parentId: 'shape:single', meta: { cowartAiImageHolder: true } } },
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 900 },
  ])
  const initial = await f.read(), args = { expectedRevision: initial.revision, anchorShapeId: 'shape:anchor', dataUrl: png }
  args.recordBasis = basisFor(initial.snapshot, [{ type: 'insert_image', args, image: { src: '/synthetic.png', w: 320, h: 180, mimeType: 'image/png' } }])
  return { ...f, initial, args }
}
for (const nested of [false, true]) {
  test(`真实HTTP：${nested ? '嵌套' : ''}旧单子组占位框替换真实解组，一次撤销恢复`, async t => {
    const f = await singleGroupHolder(t, nested), reply = await f.post('/api/canvas/image', f.args)
    assert.equal(reply.status, 200, JSON.stringify(reply.body))
    const saved = await f.read(), image = Object.values(saved.snapshot.store).find(r => r.typeName === 'shape' && r.type === 'image')
    assert.equal(saved.snapshot.store['shape:single'], undefined)
    if (nested) assert.equal(saved.snapshot.store['shape:outer'], undefined)
    assert.equal(image.parentId, f.pageId)
    const undo = await f.post('/api/canvas/undo', { expectedRevision: saved.revision })
    assert.equal(undo.status, 200); assert.deepEqual(undo.body.snapshot, f.initial.snapshot)
  })
  test(`真实HTTP：${nested ? '嵌套' : ''}旧单子组替换拒绝删除远端新绑定，零新增文件`, async t => {
    const f = await singleGroupHolder(t, nested), toId = nested ? 'shape:outer' : 'shape:single'
    await f.remote([{ type: 'put', record: { id: 'binding:remote-new', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId, props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } }])
    const before = await f.read(), files = await f.files(), reply = await f.post('/api/canvas/image', f.args)
    assert.equal(reply.status, 409, JSON.stringify(reply.body))
    assert.deepEqual(await f.read(), before); assert.deepEqual(await f.files(), files)
    assert.ok((await f.read()).snapshot.store['binding:remote-new'])
  })
}

for (const remove of [false, true]) test(`真实HTTP：同组${remove ? '删除' : '新增'}成员有意保守拒绝，不覆盖组整理`, async t => {
  const f = await setup(t)
  await f.remote([
    { type: 'create_shape', id: 'shape:group', shapeType: 'group' },
    { type: 'update', id: 'shape:anchor', changes: { parentId: 'shape:group', meta: { cowartAiImageHolder: true } } },
    { type: 'create_shape', id: 'shape:peer', shapeType: 'geo', parentId: 'shape:group' },
  ])
  const initial = await f.read(), args = { expectedRevision: initial.revision, anchorShapeId: 'shape:anchor', dataUrl: png }
  args.recordBasis = basisFor(initial.snapshot, [{ type: 'insert_image', args, image: { src: '/synthetic.png', w: 320, h: 180, mimeType: 'image/png' } }])
  await f.remote(remove ? [{ type: 'delete', ids: ['shape:peer'] }] : [{ type: 'create_shape', id: 'shape:late-peer', shapeType: 'geo', parentId: 'shape:group' }])
  const before = await f.read(), files = await f.files(), reply = await f.post('/api/canvas/image', args)
  assert.equal(reply.status, 409, JSON.stringify(reply.body)); assert.deepEqual(await f.read(), before); assert.deepEqual(await f.files(), files)
})

test('通用不变量：替换执行实际更新或删除的既有记录必须全部进入依赖', () => {
  const media = { src: '/c/synthetic/assets/image.png', w: 320, h: 180, mimeType: 'image/png' }, covered = []
  function verify(snapshot, commands, label) {
    const dependencies = new Set(getRecordDependencies(snapshot, commands).ids), { changes } = executeCanvasCommands(snapshot, commands)
    for (const id of [...Object.keys(changes.updated), ...Object.keys(changes.removed)]) {
      if (snapshot.store[id]) assert.ok(dependencies.has(id), `${label}遗漏实际修改的既有记录${id}`)
    }
    covered.push(label)
  }
  for (const config of [
    { label: '页内无标注' }, { label: '页内保留标注', annotations: 1 },
    { label: '组内两个子项', depth: 1, peer: true }, { label: '组内两个子项及标注', depth: 1, peer: true, annotations: 1 },
    { label: '旧单子组', depth: 1 }, { label: '单子组补入标注后不解组', depth: 1, annotations: 1 },
    { label: '嵌套单子组', depth: 2 }, { label: '提升后外组仍两个子项', depth: 2, outerPeer: true },
    { label: 'Slides重排标注及已有图片', slides: true, annotations: 1 },
    { label: '占位框绑定的存活箭头', binding: 'holder' },
    { label: '单子组绑定的存活箭头', depth: 1, binding: 'group0' },
    { label: '嵌套外组绑定的存活箭头', depth: 2, binding: 'group0' },
  ]) {
    const base = createCanvasSnapshot(), pageId = Object.values(base.store).find(r => r.typeName === 'page').id
    const operations = [{ type: 'create_shape', id: 'shape:far', shapeType: 'geo', x: 2000 }]
    let parentId = pageId
    for (let i = 0; i < (config.depth || 0); i++) {
      const id = `shape:group${i}`
      operations.push({ type: 'create_shape', id, shapeType: 'group', parentId }); parentId = id
    }
    if (config.slides) {
      operations.push({ type: 'create_shape', id: 'shape:slides', shapeType: 'frame', meta: { cowartAiSlides: true } }, { type: 'create_shape', id: 'shape:slide-peer', shapeType: 'image', parentId: 'shape:slides' })
      parentId = 'shape:slides'
    }
    operations.push({ type: 'create_shape', id: 'shape:holder', shapeType: 'frame', parentId, meta: { cowartAiImageHolder: true } })
    if (config.peer || config.outerPeer) operations.push({ type: 'create_shape', id: 'shape:peer', shapeType: 'geo', parentId: config.outerPeer ? 'shape:group0' : parentId })
    if (config.annotations) operations.push({ type: 'create_shape', id: 'shape:annotation', shapeType: 'geo', parentId: 'shape:holder', x: 10, y: 20 })
    if (config.binding) operations.push({ type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow' }, { type: 'put', record: { id: 'binding:fixture', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: `shape:${config.binding}`, props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } })
    const { snapshot } = executeCanvasCommands(base, operations)
    verify(snapshot, [{ type: 'insert_image', args: { anchorShapeId: 'shape:holder' }, image: media }], config.label)
  }
  for (const kind of ['image', 'video']) for (const parent of ['page', 'frame', 'slides', 'group']) {
    const base = createCanvasSnapshot(), item = { ...media, ...(kind === 'video' && { src: '/c/synthetic/assets/video.mp4', mimeType: 'video/mp4' }) }
    let { snapshot, results } = executeCanvasCommands(base, [{ type: `insert_${kind}`, [kind]: item }])
    const id = results[0].shapeId
    if (parent !== 'page') snapshot = executeCanvasCommands(snapshot, [
      { type: 'create_shape', id: 'shape:parent', shapeType: parent === 'group' ? 'group' : 'frame', ...(parent === 'slides' && { meta: { cowartAiSlides: true } }) },
      { type: 'update', id, changes: { parentId: 'shape:parent' } },
      { type: 'create_shape', id: 'shape:peer', shapeType: parent === 'slides' ? 'image' : 'geo', parentId: 'shape:parent' },
    ]).snapshot
    verify(snapshot, [{ type: `replace_${kind}`, id, [kind]: { ...item, w: 160, h: 320 } }], `${kind}既有媒体-${parent}`)
  }
  assert.equal(covered.length, 20)
})
