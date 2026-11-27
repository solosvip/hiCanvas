import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import * as engine from '../engine/index.js'
import { createCanvasSnapshot, createCanvasStore } from '../model/index.js'
import { executeCanvasCommands, createClipboardContent, planClipboardPaste } from '../engine/index.js'

const deck = { type: 'create_shape', id: 'shape:deck', shapeType: 'frame', x: 250, y: 170, props: { w: 280, h: 180 }, meta: { cowartAiSlides: true } }
const page = (id, x, w, h, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'image', parentId: 'shape:deck', x, y: 80, props: { w, h }, ...extra })

test('新增三页与框尺寸在同一事务整理，输入快照不变', () => {
  const before = executeCanvasCommands(createCanvasSnapshot(), [deck]).snapshot
  const result = executeCanvasCommands(before, [page('p1', 40, 240, 140), page('p2', 400, 360, 220), page('p3', 850, 180, 170)])
  assert.deepEqual(['p1', 'p2', 'p3'].map(id => { const r = result.snapshot.store[`shape:${id}`]; return [r.x, r.y, r.rotation] }), [[12, 12, 0], [284, 12, 0], [676, 12, 0]])
  assert.deepEqual([result.snapshot.store['shape:deck'].props.w, result.snapshot.store['shape:deck'].props.h], [1048, 600])
  assert.equal(before.store['shape:deck'].props.w, 280)
  assert.deepEqual(result.changes.updated['shape:deck'][0], before.store['shape:deck'])
})

test('批次中移走再还原及临时创建再删除，不触发旧Slides的旁观排版', () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck, page('p1', 40, 240, 140), page('p2', 400, 360, 220)]).snapshot
  // A valid saved deck may still have the legacy geometry. A net no-op is
  // not permission to migrate or reflow it as a side effect.
  snapshot.store['shape:p1'].x = 60
  snapshot.store['shape:p1'].y = 80
  snapshot.store['shape:deck'].props = { ...snapshot.store['shape:deck'].props, w: 1600, h: 900 }
  const before = structuredClone(snapshot)
  const result = executeCanvasCommands(snapshot, [
    { type: 'update', id: 'shape:p1', changes: { x: 999 } },
    { type: 'update', id: 'shape:p1', changes: { x: 60 } },
    page('temporary', 1200, 180, 100),
    { type: 'delete', ids: ['shape:temporary'] }
  ])
  assert.deepEqual(result.snapshot, before)
  assert.deepEqual(result.changes, { added: {}, updated: {}, removed: {} })
  assert.deepEqual(snapshot, before)
})

test('移动锁页才整笔拒绝，锁页后追加仍可完成，父锁下不能删子页', () => {
  let snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck, page('p1', 40, 240, 140), page('p2', 400, 360, 220)]).snapshot
  snapshot = executeCanvasCommands(snapshot, [{ type: 'toggle_lock', ids: ['shape:p2'] }]).snapshot
  const before = structuredClone(snapshot)
  assert.throws(() => executeCanvasCommands(snapshot, [{ type: 'delete', ids: ['shape:p1'] }]), e => e.code === 'slides-layout-locked' && /锁定的页/.test(e.message))
  assert.deepEqual(snapshot, before)
  const append = executeCanvasCommands(snapshot, [page('p3', 900, 180, 170)])
  assert.equal(append.snapshot.store['shape:p3'].x, 676)
  assert.deepEqual(append.snapshot.store['shape:p2'], before.store['shape:p2'])
  snapshot = executeCanvasCommands(append.snapshot, [{ type: 'toggle_lock', ids: ['shape:deck'] }]).snapshot
  assert.throws(() => executeCanvasCommands(snapshot, [{ type: 'delete', ids: ['shape:p3'] }]), e => e.code === 'slides-layout-locked')
})

test('只收纳本次新建且未显式指定父级的提示页，明确移出与旧对象不被拉回', () => {
  let snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck]).snapshot
  const hint = { cowartAiSlidesParentShapeId: 'shape:deck' }
  snapshot = executeCanvasCommands(snapshot, [page('auto', 700, 240, 140, { parentId: undefined, meta: hint })]).snapshot
  assert.equal(snapshot.store['shape:auto'].parentId, 'shape:deck')
  snapshot = executeCanvasCommands(snapshot, [{ type: 'reparent_shapes', ids: ['shape:auto'], parentId: 'page:page' }]).snapshot
  assert.equal(snapshot.store['shape:auto'].parentId, 'page:page')
  assert.equal(snapshot.store['shape:auto'].meta.cowartAiSlidesParentShapeId, undefined)
  snapshot = executeCanvasCommands(snapshot, [page('explicit', 900, 180, 170, { parentId: 'page:page', meta: hint })]).snapshot
  assert.equal(snapshot.store['shape:explicit'].parentId, 'page:page')
  // A saved historical hint, even edited now, does not authorize adoption.
  snapshot.store['shape:auto'].meta.cowartAiSlidesParentShapeId = 'shape:deck'
  snapshot = executeCanvasCommands(snapshot, [{ type: 'update', id: 'shape:auto', changes: { x: 999 } }]).snapshot
  assert.equal(snapshot.store['shape:auto'].parentId, 'page:page')
})

test('唯一选中 Slides 或直接作品页时粘贴进该容器；整套复制保树且源不变', () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck, page('p1', 40, 240, 140), page('p2', 400, 360, 220, { meta: { cowartAiSlidesParentShapeId: 'shape:deck' } }), page('source', 1100, 180, 170, { parentId: 'page:page' })]).snapshot
  const viewport = { x: 0, y: 0, w: 1800, h: 1000 }, content = createClipboardContent(snapshot, ['shape:source'], { boardId: 'synthetic' })
  for (const selected of ['shape:deck', 'shape:p1']) {
    const placement = planClipboardPaste(snapshot, content, { viewport, boardId: 'synthetic', selectedIds: [selected] })
    assert.equal(placement.parentId, 'shape:deck')
    const result = executeCanvasCommands(snapshot, [{ type: 'paste_content', content, ...placement }])
    assert.equal(result.snapshot.store[result.results[0].rootIds[0]].parentId, 'shape:deck')
    assert.deepEqual(result.snapshot.store['shape:source'], snapshot.store['shape:source'])
  }
  const whole = createClipboardContent(snapshot, ['shape:deck'], { boardId: 'synthetic' })
  const placement = planClipboardPaste(snapshot, whole, { viewport, boardId: 'synthetic', selectedIds: ['shape:deck'] })
  assert.equal(placement.parentId, 'page:page', '整套复制不能进原容器')
  for (const command of [{ type: 'paste_content', content: whole, ...placement }, { type: 'duplicate_shapes', ids: ['shape:deck'] }]) {
    const result = executeCanvasCommands(snapshot, [command]), map = result.results[0].idMap
    for (const id of ['shape:p1', 'shape:p2']) assert.equal(result.snapshot.store[map[id]].parentId, map['shape:deck'])
    assert.equal(result.snapshot.store[map['shape:p2']].meta.cowartAiSlidesParentShapeId, map['shape:deck'])
    for (const id of ['shape:deck', 'shape:p1', 'shape:p2']) assert.deepEqual(result.snapshot.store[id], snapshot.store[id])
  }
  assert.equal(planClipboardPaste(snapshot, content, { viewport, selectedIds: ['shape:deck'], strategy: 'viewport-page' }).parentId, 'page:page')
  const clipped = planClipboardPaste(snapshot, content, { viewport, selectedIds: ['shape:deck'], atCursor: true, point: { x: 1700, y: 1700 } })
  assert.equal(clipped.parentId, 'page:page', '沿既有裁切守卫，不能把粘贴藏在选中框外')
})

test('同批插入再删除容器，回执不声称已删除的页仍在最终存档', () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck]).snapshot
  const result = executeCanvasCommands(snapshot, [{ type: 'insert_html', args: { draftShapeId: 'shape:deck' }, html: { url: 'data:text/html,<h1>synthetic</h1>', assetUrl: '/assets/synthetic.html', contentHash: 'synthetic' } }, { type: 'delete', ids: ['shape:deck'] }])
  assert.equal(result.results[0].shapeRecord, null)
  assert.equal(result.results[0].bounds, null)
  assert.equal(result.snapshot.store[result.results[0].shapeId], undefined)
})


let legacyAdapter
async function loadLegacyAdapter() {
  if (legacyAdapter) return legacyAdapter
  // Bundle real first-party caches/config and adapter. Only Vite's asset loader,
  // opaque SDK asset URLs, and the browser editor boundary are stand-ins.
  const bundled = await build({ stdin: { contents: "export {preparePastedItemForAiSlides,movePastedItemsIntoAiSlides,getPendingAiSlidesPaste,cowartTldrawOptions} from './src/editor/slidesLayout.jsx'", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'cjs', platform: 'node', define: { 'import.meta.glob': '__fixtureGlob', __COWART_WIDGET_BUILD__: 'false' }, plugins: [{ name: 'external-assets-only', setup(builder) {
    builder.onResolve({ filter: /./ }, args => args.path === '../../engine/index.js' || args.path === '@tldraw/assets/imports.vite' ? { path: args.path, external: true } : undefined)
    builder.onResolve({ filter: /\.svg\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'first-party-svg' }))
    builder.onLoad({ filter: /.*/, namespace: 'first-party-svg' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }))
  } }] })
  legacyAdapter = runInNewContext(bundled.outputFiles[0].text + ';module.exports', { module: { exports: {} }, exports: {}, __fixtureGlob: () => ({}), window: { addEventListener() {} }, console, structuredClone, require: path => {
    if (path === '../../engine/index.js') return engine
    assert.equal(path, '@tldraw/assets/imports.vite')
    return { getAssetUrlsByImport: () => ({ icons: {} }) }
  } })
  return legacyAdapter
}

test('旧界面创建前钩子不能把公开整套复制结果的后代塞回原Slides', async () => {
  const adapter = await loadLegacyAdapter()
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck, page('p1', 40, 240, 140), page('p2', 400, 360, 220)]).snapshot
  const content = createClipboardContent(snapshot, ['shape:deck'], { boardId: 'synthetic' })
  const copied = executeCanvasCommands(snapshot, [{ type: 'paste_content', content, parentId: 'page:page' }])
  const map = copied.results[0].idMap
  const editor = { getOnlySelectedShape: () => snapshot.store['shape:deck'], getCurrentPageShapeIds: () => new Set(Object.values(snapshot.store).filter(r => r.typeName === 'shape').map(r => r.id)), getShape: id => copied.snapshot.store[id] }
  adapter.cowartTldrawOptions.onBeforePasteFromClipboard({ editor })
  for (const id of ['shape:p1', 'shape:p2']) {
    const shape = copied.snapshot.store[map[id]], prepared = adapter.preparePastedItemForAiSlides(editor, shape, 'user')
    assert.equal(prepared.parentId, map['shape:deck'], '本次新复制父级必须优先于仍选中的原Slides')
  }
  for (const id of ['shape:deck', 'shape:p1', 'shape:p2']) assert.deepEqual(copied.snapshot.store[id], snapshot.store[id])
})

test('旧界面整树粘贴只整理新树提示，保留源与根落点并清理pending', async () => {
  const adapter = await loadLegacyAdapter()
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck,
    page('p1', 40, 240, 140, { meta: { cowartAiSlidesParentShapeId: 'shape:deck', keep: 'source' } }),
    { type: 'create_shape', id: 'shape:ordinary', shapeType: 'frame', x: 1400, y: 800, props: { w: 700, h: 400 } },
    page('nested', 60, 200, 100, { parentId: 'shape:ordinary', meta: { keep: 'nested' } }),
    page('historical', 1900, 220, 100, { parentId: 'page:page' })
  ]).snapshot
  snapshot.store['shape:historical'].meta.cowartAiSlidesParentShapeId = 'shape:deck'
  const content = createClipboardContent(snapshot, ['shape:deck', 'shape:ordinary'], { boardId: 'synthetic' })
  const copied = executeCanvasCommands(snapshot, [{ type: 'paste_content', content, parentId: 'page:page' }])
  const map = copied.results[0].idMap, candidate = structuredClone(copied.snapshot)
  // Emulate opaque clipboard remapping leaving source hint strings unchanged.
  candidate.store[map['shape:p1']].meta.cowartAiSlidesParentShapeId = 'shape:deck'
  candidate.store[map['shape:nested']].meta.cowartAiSlidesParentShapeId = 'shape:deck'
  const store = createCanvasStore()
  store.loadStoreSnapshot(candidate)
  const visits = []
  let redoSnapshot = structuredClone(candidate)
  // The adapter runs in a VM realm; clone at that external boundary so the
  // real Store validates same-realm JSON objects, as it does in the browser.
  const editor = { store: { put: records => store.put(structuredClone(records)) }, getOnlySelectedShape: () => store.get('shape:deck'),
    getCurrentPageShapeIds: () => Object.values(snapshot.store).filter(r => r.typeName === 'shape').map(r => r.id),
    getShape: id => store.get(id), getSelectedShapes: () => copied.results[0].rootIds.map(id => store.get(id)),
    getSortedChildIdsForParent: id => { visits.push(id); return store.query.records('shape', () => ({ parentId: { eq: id } })).get().map(r => r.id) },
    // External browser history boundary: ignored writes do not enter the
    // copied records replayed by redo. Native legacy coverage checks this
    // same paste/undo/redo chain against the actual editor runtime.
    run: (callback, options) => {
      assert.equal(adapter.getPendingAiSlidesPaste(editor), null, '批处理再入前先清pending')
      callback()
      if (options?.history !== 'ignore') redoSnapshot = structuredClone(store.getStoreSnapshot())
    }
  }
  adapter.cowartTldrawOptions.onBeforePasteFromClipboard({ editor })
  assert.equal(adapter.movePastedItemsIntoAiSlides(editor), false, '整树走既有后续排版，不伪装成单页收纳')
  assert.equal(adapter.getPendingAiSlidesPaste(editor), null)
  assert.equal(store.get(map['shape:p1']).meta.cowartAiSlidesParentShapeId, map['shape:deck'])
  assert.equal(Object.hasOwn(store.get(map['shape:nested']).meta, 'cowartAiSlidesParentShapeId'), false)
  assert.equal(store.get(map['shape:p1']).meta.keep, 'source')
  assert.equal(store.get(map['shape:nested']).meta.keep, 'nested')
  for (const rootId of copied.results[0].rootIds) assert.deepEqual(store.get(rootId), candidate.store[rootId])
  assert.equal(store.get(map['shape:p1']).parentId, map['shape:deck'])
  assert.equal(store.get(map['shape:nested']).parentId, map['shape:ordinary'])
  for (const record of Object.values(snapshot.store)) assert.deepEqual(store.get(record.id), record)
  assert.ok(visits.length > 0)
  assert.ok(visits.every(id => Object.values(map).includes(id)), '不得查询历史容器的子页')
  const unrelated = { ...store.get(map['shape:p1']), id: 'shape:later', parentId: 'page:page' }
  assert.equal(adapter.preparePastedItemForAiSlides(editor, unrelated, 'user'), unrelated)
  const settled = structuredClone(store.getStoreSnapshot())
  store.loadStoreSnapshot(snapshot)
  for (const record of Object.values(snapshot.store)) assert.deepEqual(store.get(record.id), record)
  store.loadStoreSnapshot(redoSnapshot)
  assert.deepEqual(store.getStoreSnapshot(), settled, '重做必须恢复提示也已修正的完整复制树')
})

test('旧界面单张图片与HTML粘贴仍进入选中Slides且只排一次', async () => {
  const adapter = await loadLegacyAdapter()
  for (const shapeType of ['image', 'embed']) {
    const snapshot = executeCanvasCommands(createCanvasSnapshot(), [deck]).snapshot
    const candidate = executeCanvasCommands(snapshot, [page('leaf', 900, 240, 140, { shapeType, parentId: 'page:page', ...(shapeType === 'embed' && { props: { w: 240, h: 140, url: 'data:text/html,<h1>synthetic</h1>' }, meta: { cowartHtmlDraft: true } }) })]).snapshot
    const store = createCanvasStore()
    store.loadStoreSnapshot(candidate)
    let layouts = 0
    const editor = { store, getOnlySelectedShape: () => store.get('shape:deck'), getCurrentPageShapeIds: () => ['shape:deck'], getShape: id => store.get(id), getSelectedShapes: () => [store.get('shape:leaf')],
      getSortedChildIdsForParent: id => store.query.records('shape', () => ({ parentId: { eq: id } })).get().map(r => r.id),
      run: callback => callback(), reparentShapes: () => assert.fail('beforeCreate已定父级，无需二次收纳'),
      updateShapes: updates => { layouts++; store.put(updates.map(({ id, ...changes }) => ({ ...store.get(id), ...changes, props: { ...store.get(id).props, ...changes.props } }))) }
    }
    adapter.cowartTldrawOptions.onBeforePasteFromClipboard({ editor })
    const prepared = adapter.preparePastedItemForAiSlides(editor, store.get('shape:leaf'), 'user')
    assert.equal(prepared.parentId, 'shape:deck')
    store.put([prepared])
    assert.equal(adapter.movePastedItemsIntoAiSlides(editor), true)
    assert.equal(layouts, 1)
    assert.deepEqual([store.get('shape:leaf').x, store.get('shape:leaf').y], [12, 12])
    assert.equal(adapter.getPendingAiSlidesPaste(editor), null)
  }
})
