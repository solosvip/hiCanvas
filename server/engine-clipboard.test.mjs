import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createClipboardContent, encodeClipboardContent, decodeClipboardContent, planClipboardPaste, executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

const shape = (id, fields = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', ...fields })
const initial = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot

test('内部内容脱离来源画板后仍能粘贴，原位落点和原始记录保持完整', () => {
  const source = initial([shape('a', { x: 100, y: 160, props: { w: 100, h: 80 } }), shape('b', { x: 340, y: 260, props: { w: 80, h: 120 } })])
  const before = structuredClone(source)
  const content = createClipboardContent(source, ['shape:a', 'shape:b'], { boardId: 'source' })
  const target = createCanvasSnapshot()
  const result = executeCanvasCommands(target, [{ type: 'paste_content', content }])
  const { idMap, rootIds } = result.results[0]
  assert.equal(rootIds.length, 2)
  assert.notEqual(idMap['shape:a'], 'shape:a')
  assert.notEqual(idMap['shape:b'], 'shape:b')
  assert.deepEqual(rootIds, ['shape:a', 'shape:b'].map(id => idMap[id]))
  assert.deepEqual(rootIds.map(id => { const r = result.snapshot.store[id]; return [r.x, r.y, r.parentId] }), [[100, 160, 'page:page'], [340, 260, 'page:page']])
  assert.deepEqual(source, before)
  assert.deepEqual(target, createCanvasSnapshot())
})

test('粘贴根解除锁定，框内子项原有锁定和来源记录保持不变', () => {
  const source = initial([shape('frame', { shapeType: 'frame' }), shape('child', { parentId: 'shape:frame' }), ...['frame', 'child'].map(name => ({ type: 'update', id: `shape:${name}`, changes: { isLocked: true } }))])
  const content = createClipboardContent(source, ['shape:frame'])
  const result = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'paste_content', content }])
  const ids = result.results[0].idMap
  assert.equal(result.snapshot.store[ids['shape:frame']].isLocked, false)
  assert.equal(result.snapshot.store[ids['shape:child']].isLocked, true)
  assert.equal(source.store['shape:frame'].isLocked, true)
})

test('默认保留原位，视口外居中，光标偏好按世界点放整体中心且不累计偏移', () => {
  const snapshot = initial([shape('a', { x: 100, y: 160, props: { w: 100, h: 80 } }), shape('b', { x: 340, y: 260, props: { w: 80, h: 120 } })])
  const content = createClipboardContent(snapshot, ['shape:a', 'shape:b'])
  const viewport = { x: 0, y: 0, w: 1000, h: 700 }, point = { x: 800, y: 550 }
  const plan = options => planClipboardPaste(snapshot, content, { viewport, point, ...options })
  assert.deepEqual(plan({}).offset, { x: 0, y: 0 })
  assert.deepEqual(plan({ viewport: { x: 1000, y: 600, w: 1000, h: 700 } }).offset, { x: 1240, y: 680 })
  assert.deepEqual(plan({ atCursor: true }).offset, { x: 540, y: 280 })
  assert.deepEqual(plan({ atCursor: true }), plan({ atCursor: true }))
  assert.deepEqual(plan({ atCursor: true, point: { x: 1400, y: 900 } }).offset, { x: 1140, y: 630 })
})

function close(actual, expected) { for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(actual[key] - value) < 1e-8, `${key}: ${actual[key]} ≠ ${value}`) }

test('旋转父链的根转成世界姿态，跨板不误认同ID容器，子孙仍用局部坐标', () => {
  const source = initial([shape('frame', { shapeType: 'frame', x: 100, y: 100, rotation: .4, props: { w: 400, h: 300 } }), shape('a', { parentId: 'shape:frame', x: 30, y: 40, props: { w: 100, h: 80 } })])
  const content = createClipboardContent(source, ['shape:a'], { boardId: 'source' })
  close(content.shapes[0], { x: 112.05509612774053, y: 148.52499002937492, rotation: .4 })
  const target = initial([shape('frame', { shapeType: 'frame', x: 700, y: 500 })])
  const plan = planClipboardPaste(target, content, { boardId: 'target', viewport: { x: 0, y: 0, w: 1000, h: 700 } })
  assert.equal(plan.parentId, 'page:page')
  const result = executeCanvasCommands(target, [{ type: 'paste_content', content, ...plan }])
  const pasted = result.snapshot.store[result.results[0].rootIds[0]]
  close(pasted, { x: 112.05509612774053, y: 148.52499002937492, rotation: .4 })
  assert.equal(pasted.parentId, 'page:page')
})

test('光标落在旋转画框时重设父容器，按旧版读数换算局部姿态', () => {
  const snapshot = initial([shape('a', { x: 100, y: 160, props: { w: 100, h: 80 } }), shape('b', { x: 340, y: 260, props: { w: 80, h: 120 } }), shape('target', { shapeType: 'frame', x: 600, y: 150, rotation: -.2, props: { w: 300, h: 400 } })])
  const content = createClipboardContent(snapshot, ['shape:a', 'shape:b'])
  const plan = planClipboardPaste(snapshot, content, { atCursor: true, point: { x: 700, y: 300 }, viewport: { x: 0, y: 0, w: 1000, h: 700 } })
  assert.equal(plan.parentId, 'shape:target')
  const result = executeCanvasCommands(snapshot, [{ type: 'paste_content', content, ...plan }]), map = result.results[0].idMap
  close(result.snapshot.store[map['shape:a']], { x: -66.750767902277, y: 27.282503265946175, rotation: .2 })
  close(result.snapshot.store[map['shape:b']], { x: 148.59827770011486, y: 172.96980044088502, rotation: .2 })
})

test('框内对象粘贴到框外光标或远处视口时回到页，避免被原框裁剪隐藏', () => {
  for (const nested of [false, true]) {
  const snapshot = initial([shape('frame', { shapeType: 'frame', props: { w: 400, h: 300 } }), ...(nested ? [shape('group', { shapeType: 'group', parentId: 'shape:frame' })] : []), shape('a', { parentId: nested ? 'shape:group' : 'shape:frame', x: 100, y: 160, props: { w: 100, h: 80 } })])
  const content = createClipboardContent(snapshot, ['shape:a'], { boardId: 'same' })
  for (const options of [{ viewport: { x: 1000, y: 600, w: 1000, h: 700 } }, { viewport: { x: 0, y: 0, w: 1000, h: 700 }, atCursor: true, point: { x: 800, y: 550 } }]) {
    const plan = planClipboardPaste(snapshot, content, { boardId: 'same', selectedIds: ['shape:a'], ...options })
    assert.equal(plan.parentId, 'page:page')
    const result = executeCanvasCommands(snapshot, [{ type: 'paste_content', content, ...plan }])
    const pasted = result.snapshot.store[result.results[0].rootIds[0]]
    assert.equal(pasted.parentId, 'page:page')
    close(pasted, options.atCursor ? { x: 750, y: 510 } : { x: 1450, y: 910 })
  }
  }
})

test('自有剪贴板格式保留Unicode和HTML字面内容，外部内容留给独立解析入口', () => {
  const source = initial([shape('a', { meta: { label: '合成 <script>& " العربية' } })])
  const content = createClipboardContent(source, ['shape:a'])
  const formats = encodeClipboardContent(content)
  assert.match(formats['text/html'], /data-hicanvas-clipboard/)
  assert.ok(!formats['text/html'].includes('<script>'))
  assert.deepEqual(decodeClipboardContent(formats), content)
  assert.equal(decodeClipboardContent({ 'text/plain': '普通文本' }), null)
  assert.equal(decodeClipboardContent({ 'text/html': '<div data-tldraw>{}</div>' }), null)
  assert.throws(() => decodeClipboardContent({ 'text/html': '<div data-hicanvas-clipboard="1">broken</div>' }))
})

test('粘贴拒绝重复ID、伪造根、缺失资源和不受支持的格式，整批目标不变', () => {
  const source = initial([shape('a')]), target = createCanvasSnapshot()
  const content = createClipboardContent(source, ['shape:a'])
  const invalid = [
    value => value.shapes.push(structuredClone(value.shapes[0])),
    value => value.rootIds.push(value.rootIds[0]),
    value => { value.rootIds = [] },
    value => { value.shapes[0].props.assetId = 'asset:missing' },
    value => { value.version = 999 },
    value => { value.origin = null },
  ]
  for (const corrupt of invalid) {
    const copy = structuredClone(content); corrupt(copy)
    assert.throws(() => executeCanvasCommands(target, [{ type: 'paste_content', content: copy }]))
  }
  assert.deepEqual(target, createCanvasSnapshot())
})

test('生成的新ID与目标或本批碰撞时拒绝，不覆盖已有对象', t => {
  const uuid = '00000000-0000-0000-0000-000000000001'
  const target = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: `shape:${uuid}`, shapeType: 'geo', x: 999 }]).snapshot
  const source = initial([shape('a')]), content = createClipboardContent(source, ['shape:a'])
  t.mock.method(globalThis.crypto, 'randomUUID', () => uuid)
  assert.throws(() => executeCanvasCommands(target, [{ type: 'paste_content', content }]))
  assert.equal(target.store[`shape:${uuid}`].x, 999)
  assert.throws(() => executeCanvasCommands(createCanvasSnapshot(), [{ type: 'paste_content', content: createClipboardContent(initial([shape('a'), shape('b')]), ['shape:a', 'shape:b']) }]))
})

test('跨板资源编号碰撞时不串图，包内共享只导入一份，和对象一起撤销重做', () => {
  const asset = { id: 'asset:shared', typeName: 'asset', type: 'image', props: { name: 'source.png', src: 'data:image/png;base64,c3ludGhldGlj', w: 1, h: 1, mimeType: 'image/png', isAnimated: false }, meta: {} }
  const source = initial([{ type: 'put', record: asset }, ...['a', 'b'].map(id => shape(id, { shapeType: 'image', props: { assetId: asset.id } }))])
  const target = initial([{ type: 'put', record: { ...asset, props: { ...asset.props, name: 'target.png', src: 'data:image/png;base64,dGFyZ2V0' } } }, shape('target', { shapeType: 'image', props: { assetId: asset.id } })])
  const content = createClipboardContent(source, ['shape:a', 'shape:b']), before = structuredClone(content)
  const result = executeCanvasCommands(target, [{ type: 'paste_content', content }]), map = result.results[0].idMap
  assert.notEqual(map[asset.id], asset.id)
  assert.equal(result.snapshot.store[map['shape:a']].props.assetId, map[asset.id])
  assert.equal(result.snapshot.store[map['shape:b']].props.assetId, map[asset.id])
  assert.deepEqual(result.snapshot.store[asset.id], target.store[asset.id])
  assert.deepEqual(result.snapshot.store[map[asset.id]].props, asset.props)
  assert.equal(Object.values(result.changes.added).filter(r => r.typeName === 'asset').length, 1)
  const history = recordCanvasTransaction(undefined, 'paste', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'paste')
  assert.deepEqual(undone.snapshot, target)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'paste').snapshot, result.snapshot)
  assert.deepEqual(content, before)
})

test('组合内容经编解码粘贴保留新父子及内部绑定，外部端点解绑，整次撤销不留残件', () => {
  const bind = (id, terminal, toId) => ({ type: 'put', record: { id: `binding:${id}`, typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId, props: { terminal, normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } })
  const source = initial([
    shape('frame', { shapeType: 'frame', x: 100, y: 100, rotation: .4 }),
    shape('a', { parentId: 'shape:frame', x: 30, y: 40 }),
    shape('arrow', { shapeType: 'arrow', parentId: 'shape:frame', x: 230, y: 100 }),
    shape('outside', { x: 700, y: 300 }), bind('internal', 'start', 'shape:a'), bind('external', 'end', 'shape:outside'),
  ])
  const before = structuredClone(source), content = decodeClipboardContent(encodeClipboardContent(createClipboardContent(source, ['shape:frame', 'shape:a'])))
  const target = createCanvasSnapshot(), result = executeCanvasCommands(target, [{ type: 'paste_content', content }]), map = result.results[0].idMap
  assert.deepEqual(result.results[0].rootIds, [map['shape:frame']])
  assert.equal(result.snapshot.store[map['shape:a']].parentId, map['shape:frame'])
  assert.equal(result.snapshot.store[map['shape:arrow']].parentId, map['shape:frame'])
  assert.equal(result.snapshot.store[map['binding:internal']].fromId, map['shape:arrow'])
  assert.equal(result.snapshot.store[map['binding:internal']].toId, map['shape:a'])
  assert.equal(map['binding:external'], undefined)
  assert.equal(map['shape:outside'], undefined)
  assert.equal(Object.values(result.changes.added).filter(r => r.typeName === 'binding').length, 1)
  const history = recordCanvasTransaction(undefined, 'paste', result.changes), undo = undoCanvasTransaction(result.snapshot, history, 'paste')
  assert.deepEqual(undo.snapshot, target)
  assert.deepEqual(redoCanvasTransaction(undo.snapshot, undo.history, 'paste').snapshot, result.snapshot)
  assert.deepEqual(source, before)
})

test('资源包拒绝重复引用、非base64、数量和字节超限，未经落盘的包不能直接导入', () => {
  const content = createClipboardContent(initial([shape('a')]), ['shape:a'])
  const valid = { url: '/c/source/assets/synthetic.png', mimeType: 'image/png', data: 'c3ludGhldGlj' }
  for (const resources of [[valid, valid], [{ ...valid, data: 'not base64!' }], [{ ...valid, mimeType: '' }], Array.from({ length: 257 }, (_, i) => ({ ...valid, url: `/c/source/assets/${i}.png` })), [{ ...valid, data: 'AAAA'.repeat(7 * 1024 * 1024) }]]) {
    assert.throws(() => encodeClipboardContent({ ...content, resources }))
  }
  const packed = { ...content, resources: [valid] }
  assert.deepEqual(decodeClipboardContent(encodeClipboardContent(packed)), packed)
  assert.throws(() => executeCanvasCommands(createCanvasSnapshot(), [{ type: 'paste_content', content: packed }]), /宿主/)
})
