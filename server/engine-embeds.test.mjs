import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as model from '../model/index.js'
import { resolveExternalEmbed } from '../renderer/embed-content.js'
import { externalSamples } from '../tools/renderer-preview/external-samples.js'
import * as engine from '../engine/index.js'
import { shapeToPagePoint, createConnectionContext, getConnectionGeometry } from '../renderer/geometry.js'
import { fixture } from './test-helpers.mjs'

test('网址模型保留实测 YouTube 起始时间和显示参数，并给出统一默认尺寸', () => {
  const result = model.resolveEmbedUrl('https://www.youtube.com/watch?v=synthetic83&t=73&controls=1&autoplay=0')
  assert.equal(result.id, 'G13')
  assert.equal(result.src, 'https://www.youtube.com/embed/synthetic83?controls=1&autoplay=0&start=73')
  assert.deepEqual(result.size, [800, 450])
})

test('网址插入只经一个语义命令创建默认嵌入或无图书签，落点在指定page的视口中心', () => {
  for (const [url, source, type, size] of [
    ['https://youtu.be/demo?t=73', 'url', 'embed', [800, 450]],
    ['https://www.tldraw.com/r/demo', 'url', 'bookmark', [300, 46]],
    ['https://www.tldraw.com/r/demo', 'iframe', 'embed', [720, 500]],
    ['http://www.youtube.com/watch?v=demo', 'iframe', 'bookmark', [300, 46]],
    ['https://example.invalid/demo', 'iframe', 'bookmark', [300, 46]],
    ['https://gist.github.com/demo/0123456789abcdef0123456789abcdef', 'url', 'bookmark', [300, 46]],
  ]) {
    const initial = model.createCanvasSnapshot(), pageId = Object.values(initial.store).find(r => r.typeName === 'page').id
    const result = engine.executeCanvasCommands(initial, [{ type: 'insert_url', id: 'shape:new-url', url, source, pageId, point: { x: 500, y: 350 } }])
    const shape = result.snapshot.store[result.results[0].shapeId]
    assert.equal(shape.type, type); assert.equal(shape.parentId, pageId)
    assert.deepEqual([shape.props.w, shape.props.h, shape.x, shape.y], [...size, 500 - size[0] / 2, 350 - size[1] / 2])
    if (type === 'bookmark') {
      const asset = result.snapshot.store[shape.props.assetId]
      assert.deepEqual(asset.props, { src: url, title: '', description: '', image: '', favicon: '' })
    }
    if (source === 'iframe' && type === 'bookmark') assert.ok(result.results[0].notice)
    assert.equal(Object.values(initial.store).filter(r => r.typeName === 'shape').length, 0)
  }
})

test('坏地址、伪造服务、非page落点与非有限坐标拒绝整批插入', () => {
  const initial = model.createCanvasSnapshot(), before = structuredClone(initial)
  for (const extra of [
    { url: 'javascript:alert(1)' }, { url: '//example.invalid' },
    { url: 'https://youtu.be/demo', serviceId: 'G06', source: 'dialog' },
    { url: 'https://example.invalid', source: 'dialog', serviceId: 'G13' },
    { url: 'https://example.invalid', pageId: 'shape:missing' },
    { url: 'https://example.invalid', point: { x: Infinity, y: 0 } },
  ]) assert.throws(() => engine.executeCanvasCommands(initial, [{ type: 'insert_url', ...extra }]))
  assert.deepEqual(initial, before)
})

test('服务表覆盖17家可嵌入来源，尺寸、普通参数与旧读数一致，Figma内层正确编码', () => {
  for (const sample of externalSamples) {
    const result = model.resolveEmbedUrl(sample.input)
    if (sample.src === null) { assert.equal(result, null, sample.input); continue }
    assert.equal(result.id, sample.id)
    assert.deepEqual(result.size, sample.size)
    if (sample.id === 'G06') {
      const input = new URL(sample.input)
      assert.equal(new URL(result.src).searchParams.get('url'), input.pathname === '/embed' ? input.searchParams.get('url') : sample.input)
      assert.equal(new URL(result.src).hash, '')
    } else assert.equal(result.src, sample.src, sample.input)
    assert.equal(resolveExternalEmbed(sample.input)?.src, result.src, '渲染也必须使用同一规范地址')
  }
})

test('每家相似域名、凭据、非默认端口、路径编码与非HTTPS都不获得嵌入权限', () => {
  for (const sample of externalSamples.filter(sample => sample.kind === 'base')) {
    const url = new URL(sample.input)
    url.hostname += '.example.invalid'
    assert.equal(model.resolveEmbedUrl(url.href), null, url.href)
  }
  for (const url of [
    'http://www.youtube.com/watch?v=demo', 'https://user@www.youtube.com/watch?v=demo',
    'https://www.youtube.com:444/watch?v=demo', '//www.youtube.com/watch?v=demo',
    'https://www.youtube.com/embed/demo%2fextra', 'https://www.val.town/v/demo%252fextra',
    'https://www.youtube.com\\@example.invalid/embed/demo', 'https://www.youtube.com/embed/demo\n',
    'https://www.youtube.com/embed/demo%0a', 'javascript:alert(1)',
  ]) assert.equal(model.resolveEmbedUrl(url), null, url)
})

test('只去危险重定向/嵌套地址，其余实测安全参数和片段保留，Figma例外仍校验内层', () => {
  const result = model.resolveEmbedUrl('https://www.tldraw.com/r/demo?foo=bar&synthetic=83&redirect=https%3A%2F%2Fevil.invalid&callback=x&other=%252F%252Fevil.invalid#local-note')
  assert.equal(result.src, 'https://www.tldraw.com/r/demo?foo=bar&synthetic=83#local-note')
  assert.equal(model.resolveEmbedUrl('https://www.tldraw.com/r/demo?%0dsecret=1&foo=bar').src, 'https://www.tldraw.com/r/demo?foo=bar')
  for (const inner of ['https://www.figma.com.example.invalid/file/abcdefghijklmnopqrstuv/demo', 'https://www.figma.com/file/abcdefghijklmnopqrstuv/demo%252fextra', 'javascript:alert(1)']) {
    assert.equal(model.resolveEmbedUrl('https://www.figma.com/embed?url=' + encodeURIComponent(inner)), null)
  }
  assert.equal(model.resolveEmbedUrl('https://www.youtube.com/watch?v=demo&controls=1&autoplay=0#https://evil.invalid').src, 'https://www.youtube.com/embed/demo?controls=1&autoplay=0')
})

function conversionFixture() {
  return engine.executeCanvasCommands(model.createCanvasSnapshot(), [
    { type: 'create_shape', shapeType: 'frame', id: 'shape:frame', x: 90, y: 60, rotation: -.23 },
    { type: 'create_shape', shapeType: 'group', id: 'shape:group', parentId: 'shape:frame', x: 50, y: 40, rotation: .31 },
    { type: 'create_shape', shapeType: 'geo', id: 'shape:sibling', parentId: 'shape:group', x: 10, y: 20 },
    { type: 'create_shape', shapeType: 'embed', id: 'shape:target', parentId: 'shape:group', x: 250, y: 150, rotation: .4, props: { w: 480, h: 270, url: 'https://youtu.be/demo' }, meta: { synthetic: 'preserve me' } },
    { type: 'update', id: 'shape:target', changes: { opacity: .7 } },
    { type: 'create_shape', shapeType: 'arrow', id: 'shape:arrow', x: 900, y: 550 },
    { type: 'put', record: { id: 'binding:target', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:target', props: { terminal: 'end', normalizedAnchor: { x: .2, y: .8 }, isExact: true, isPrecise: true, snap: 'edge' }, meta: { synthetic: 'binding' } } },
  ]).snapshot
}
const centerOf = (snapshot, shape) => shapeToPagePoint(snapshot, shape.id, { x: shape.props.w / 2, y: shape.props.h / 2 })

test('同ID两向互转保留旋转父链中心、组、层序、opacity/meta及绑定，并一步完整撤销重做', () => {
  let initial = conversionFixture()
  for (const to of ['bookmark', 'embed']) {
    const previous = initial.store['shape:target'], center = centerOf(initial, previous)
    const result = engine.executeCanvasCommands(initial, [{ type: 'convert_url_shape', id: previous.id, to }])
    const next = result.snapshot.store[previous.id]
    assert.equal(next.type, to)
    assert.deepEqual([next.props.w, next.props.h], to === 'bookmark' ? [300, 46] : [800, 450])
    for (const key of ['id', 'parentId', 'index', 'rotation', 'opacity', 'meta', 'isLocked']) assert.deepEqual(next[key], previous[key], key)
    const afterCenter = centerOf(result.snapshot, next)
    assert.ok(Math.hypot(afterCenter.x - center.x, afterCenter.y - center.y) < 1e-8)
    for (const id of ['shape:frame', 'shape:group', 'shape:sibling', 'shape:arrow', 'binding:target']) assert.deepEqual(result.snapshot.store[id], initial.store[id], id)
    const binding = result.snapshot.store['binding:target']
    const arrow = result.snapshot.store['shape:arrow']
    const endpoint = snapshot => getConnectionGeometry(arrow, createConnectionContext(Object.values(snapshot.store))).path.at(1)
    const expected = shapeToPagePoint(result.snapshot, next.id, { x: next.props.w * binding.props.normalizedAnchor.x, y: next.props.h * binding.props.normalizedAnchor.y })
    const actual = endpoint(result.snapshot)
    assert.ok(Math.hypot(actual.x - (expected.x - arrow.x), actual.y - (expected.y - arrow.y)) < 1e-8)
    assert.notDeepEqual(endpoint(result.snapshot), endpoint(initial), '绑定端点跟随新形状几何重算')
    const history = engine.recordCanvasTransaction(undefined, 'convert', result.changes)
    const undone = engine.undoCanvasTransaction(result.snapshot, history, 'convert')
    assert.deepEqual(undone.snapshot, initial)
    assert.deepEqual(engine.redoCanvasTransaction(undone.snapshot, undone.history, 'convert').snapshot, result.snapshot)
    initial = result.snapshot
  }
})

test('书签转嵌入同事务删除孤立资源，一步撤销逐字段还原并可重做', () => {
  const initial = engine.executeCanvasCommands(conversionFixture(), [{ type: 'convert_url_shape', id: 'shape:target', to: 'bookmark' }]).snapshot
  const assetId = initial.store['shape:target'].props.assetId, before = structuredClone(initial)
  const result = engine.executeCanvasCommands(initial, [{ type: 'convert_url_shape', id: 'shape:target', to: 'embed' }])
  assert.equal(result.snapshot.store['shape:target'].type, 'embed')
  assert.equal(result.snapshot.store[assetId], undefined, '转换后无人引用的旧书签资源必须删除')
  assert.equal(Object.values(result.snapshot.store).filter(record => record.typeName === 'asset').length, 0)
  assert.deepEqual(result.changes.removed[assetId], initial.store[assetId], '资源删除属于同一转换事务')
  assert.deepEqual(initial, before, '不修改调用方快照')
  const history = engine.recordCanvasTransaction(undefined, 'convert', result.changes)
  const undone = engine.undoCanvasTransaction(result.snapshot, history, 'convert')
  assert.deepEqual(undone.snapshot, before)
  assert.deepEqual(engine.redoCanvasTransaction(undone.snapshot, undone.history, 'convert').snapshot, result.snapshot)
})

test('嵌入与书签反复互转不积攒孤立资源，每步撤销恢复完整转换前快照', () => {
  let snapshot = conversionFixture()
  for (const [to, count] of [['bookmark', 1], ['embed', 0], ['bookmark', 1], ['embed', 0], ['bookmark', 1]]) {
    const before = structuredClone(snapshot)
    const result = engine.executeCanvasCommands(snapshot, [{ type: 'convert_url_shape', id: 'shape:target', to }])
    const records = Object.values(result.snapshot.store), assets = records.filter(record => record.typeName === 'asset' && record.type === 'bookmark')
    assert.equal(assets.length, count)
    assert.equal(assets.filter(asset => !records.some(record => record.typeName === 'shape' && record.props.assetId === asset.id)).length, 0)
    const history = engine.recordCanvasTransaction(undefined, 'convert', result.changes)
    const undone = engine.undoCanvasTransaction(result.snapshot, history, 'convert')
    assert.deepEqual(undone.snapshot, before)
    assert.deepEqual(engine.redoCanvasTransaction(undone.snapshot, undone.history, 'convert').snapshot, result.snapshot)
    snapshot = result.snapshot
  }
})

test('两个书签共用资源时只转换当前形状，共用资源及锁定的另一书签不变', () => {
  const bookmark = engine.executeCanvasCommands(conversionFixture(), [{ type: 'convert_url_shape', id: 'shape:target', to: 'bookmark' }]).snapshot
  const target = bookmark.store['shape:target'], asset = bookmark.store[target.props.assetId]
  const initial = engine.executeCanvasCommands(bookmark, [
    { type: 'put', record: { ...target, id: 'shape:shared-bookmark', index: 'a9', isLocked: true, meta: { synthetic: 'shared' } } },
    { type: 'put', record: { ...asset, props: { ...asset.props, title: '共享的合成书签信息' } } },
  ]).snapshot
  const result = engine.executeCanvasCommands(initial, [{ type: 'convert_url_shape', id: target.id, to: 'embed' }])
  assert.equal(result.snapshot.store[target.id].type, 'embed')
  assert.equal(Object.values(result.snapshot.store).filter(record => record.typeName === 'asset').length, 1)
  assert.deepEqual(result.snapshot.store[asset.id], initial.store[asset.id])
  assert.deepEqual(result.snapshot.store['shape:shared-bookmark'], initial.store['shape:shared-bookmark'])
  assert.equal(result.changes.removed[asset.id], undefined)
  const history = engine.recordCanvasTransaction(undefined, 'convert', result.changes)
  const undone = engine.undoCanvasTransaction(result.snapshot, history, 'convert')
  assert.deepEqual(undone.snapshot, initial)
  assert.deepEqual(engine.redoCanvasTransaction(undone.snapshot, undone.history, 'convert').snapshot, result.snapshot)
})

test('锁定自身/祖先、未知书签、生成内容、相同目标及通用update改type均整批拒绝', () => {
  const initial = conversionFixture()
  for (const locked of ['shape:target', 'shape:group', 'shape:frame']) {
    const snapshot = engine.executeCanvasCommands(initial, [{ type: 'update', id: locked, changes: { isLocked: true } }]).snapshot
    assert.throws(() => engine.executeCanvasCommands(snapshot, [{ type: 'convert_url_shape', id: 'shape:target', to: 'bookmark' }]))
  }
  const bookmark = engine.executeCanvasCommands(model.createCanvasSnapshot(), [{ type: 'insert_url', id: 'shape:unknown', url: 'https://unknown.example.invalid' }]).snapshot
  for (const command of [
    { type: 'convert_url_shape', id: 'shape:unknown', to: 'embed' },
    { type: 'convert_url_shape', id: 'shape:unknown', to: 'bookmark' },
    { type: 'convert_url_shape', id: 'shape:missing', to: 'embed' },
  ]) assert.throws(() => engine.executeCanvasCommands(bookmark, [command]))
  for (const changes of [{ props: { url: 'data:text/html,synthetic' } }, { props: { url: '/assets/synthetic.html' } }, { meta: { cowartHtmlDraft: true } }]) {
    const generated = engine.executeCanvasCommands(initial, [{ type: 'update', id: 'shape:target', changes }]).snapshot
    assert.throws(() => engine.executeCanvasCommands(generated, [{ type: 'convert_url_shape', id: 'shape:target', to: 'bookmark' }]))
  }
  assert.throws(() => engine.executeCanvasCommands(initial, [{ type: 'update', id: 'shape:target', changes: { type: 'bookmark' } }]), /类型/)
  assert.throws(() => engine.executeCanvasCommands(initial, [{ type: 'convert_url_shape', id: 'shape:target', to: 'other' }]))
  const original = structuredClone(initial)
  assert.throws(() => engine.executeCanvasCommands(initial, [{ type: 'update', id: 'shape:sibling', changes: { x: 999 } }, { type: 'convert_url_shape', id: 'shape:target', to: 'embed' }]))
  assert.deepEqual(initial, original)
})

test('本机HTTP互转沿同一模型校验及一条命令，拒绝过期/改类型且一次历史完整恢复', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open()
  const path = `/api/canvas?conversation=${id}`, commands = `/api/canvas/operations?conversation=${id}`
  const opened = await workspace.read(id), seed = conversionFixture(), actor = { 'x-hicanvas-actor': 'ui:convert' }
  const baseline = await workspace.replaceLegacySnapshot(id, opened.revision, seed)
  const converted = await api(commands, 'POST', { expectedRevision: baseline.revision, operations: [{ type: 'convert_url_shape', id: 'shape:target', to: 'bookmark' }] }, actor)
  assert.equal(converted.status, 200)
  assert.equal(converted.body.snapshot.store['shape:target'].type, 'bookmark')
  const beforeRejected = await workspace.read(id)
  const stale = await api(commands, 'POST', { expectedRevision: baseline.revision, operations: [{ type: 'convert_url_shape', id: 'shape:target', to: 'embed' }] }, actor)
  assert.equal(stale.status, 409)
  const invalid = await api(commands, 'POST', { expectedRevision: beforeRejected.revision, operations: [{ type: 'update', id: 'shape:target', changes: { type: 'embed' } }] }, actor)
  assert.equal(invalid.status, 400)
  assert.deepEqual((await api(path)).body.snapshot, beforeRejected.snapshot)
  assert.equal((await api(path)).body.revision, beforeRejected.revision)
  const undone = await api(`/api/canvas/undo?conversation=${id}`, 'POST', { expectedRevision: beforeRejected.revision }, actor)
  assert.equal(undone.status, 200); assert.deepEqual(undone.body.snapshot, seed)
  const redone = await api(`/api/canvas/redo?conversation=${id}`, 'POST', { expectedRevision: undone.body.revision }, actor)
  assert.equal(redone.status, 200); assert.deepEqual(redone.body.snapshot, converted.body.snapshot)
})
