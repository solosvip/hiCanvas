import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createCanvasInteraction, createEditorSession, executeCanvasCommands, createClipboardContent, encodeClipboardContent, decodeClipboardContent, planClipboardPaste } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'
import { createShapeLinksFixture } from './renderer-preview/shape-links-fixture.js'

async function setup({ url = '', delay = null, fail = false } = {}) {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:one', shapeType: 'geo', props: { fill: 'solid', url } }]).snapshot
  const transport = memoryTransport(snapshot), session = await createEditorSession({ actor: 'links-test', transport })
  const commit = transport.commit
  transport.commit = async request => { if (delay) await delay; if (fail) throw new Error('合成提交失败'); return commit(request) }
  const interaction = createCanvasInteraction({ session, toolIds: ['select', 'hand', 'laser', 'text'], edgeScrolling: false })
  interaction.select('first')
  return { transport, session, interaction, link: value => interaction.link(value), shape: () => session.store.get('shape:one'),
    remote: async commands => { await commit({ commands, actor: 'other', expectedRevision: session.state.get().revision }); await session.refresh() },
    close() { interaction.dispose(); session.dispose() } }
}

test('网址草稿不写入，裸域名仅在交互层补协议，确认整次提交且一次撤销', async () => {
  const f = await setup()
  try {
    assert.equal(f.interaction.getLinks().canEdit, true)
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/links?one#two' })
    assert.equal(f.shape().props.url, ''); assert.equal(f.transport.getCommitCount(), 0)
    assert.equal(f.interaction.state.get().linkEditing.valid, true)
    await f.link({ type: 'submit' })
    assert.equal(f.shape().props.url, 'https://example.invalid/links?one#two')
    assert.equal(f.transport.getCommitCount(), 1)
    assert.equal(f.interaction.state.get().linkEditing, null)
    assert.equal(f.interaction.getLinks().items[0].url, 'https://example.invalid/links?one#two')
    await f.session.undo(); assert.equal(f.shape().props.url, '')
    await f.session.redo(); assert.equal(f.shape().props.url, 'https://example.invalid/links?one#two')
  } finally { f.close() }
})

test('显式方案/相对地址不会补协议；无效提交不改变版本，草稿保留', async () => {
  const f = await setup()
  try {
    f.link({ type: 'open' })
    for (const url of ['/relative', '//example.invalid/relative', 'javascript:void(0)', 'data:text/plain,a', 'localhost:3000', 'https://example.invalid:3000', 'https://u:p@example.invalid', 'example.invalid/space here', '\nhttps://example.invalid/path', 'https://example.invalid/path\t', '\u000bexample.invalid/path\u000b']) {
      f.link({ type: 'update', url })
      assert.equal(f.interaction.state.get().linkEditing.valid, false, url)
      await assert.rejects(f.link({ type: 'submit' }))
      assert.equal(f.interaction.state.get().linkEditing.url, url)
      assert.equal(f.session.state.get().revision, '0'); assert.equal(f.transport.getCommitCount(), 0)
    }
    f.link({ type: 'update', url: ' http://example.invalid:80/path ' })
    await f.link({ type: 'submit' }); assert.equal(f.shape().props.url, 'http://example.invalid/path')
  } finally { f.close() }
})

test('重叠链接按画布 index 的 ASCII 层序排序，不用语言排序颠倒目标', async () => {
  const f = await setup({ url: 'https://example.invalid/lower' })
  try {
    await f.remote([{ type: 'update', id: 'shape:one', changes: { index: 'aA' } },
      { type: 'create_shape', id: 'shape:upper', shapeType: 'geo', props: { url: 'https://example.invalid/upper' } },
      { type: 'update', id: 'shape:upper', changes: { index: 'aa' } }])
    assert.equal(f.session.store.get('shape:upper').index, 'aa')
    assert.deepEqual(f.interaction.getLinks().items.map(r => r.id), ['shape:one', 'shape:upper'])
  } finally { f.close() }
})

test('等价确认/取消不提交，明确清除一次提交，草稿与焦点不进历史', async () => {
  const f = await setup({ url: 'HTTPS://EXAMPLE.INVALID/same' })
  try {
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/same' }); await f.link({ type: 'submit' })
    assert.equal(f.transport.getCommitCount(), 0); assert.equal(f.session.state.get().revision, '0')
    assert.equal(f.shape().props.url, 'HTTPS://EXAMPLE.INVALID/same')
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/cancel' }); f.link({ type: 'cancel' })
    assert.equal(f.transport.getCommitCount(), 0)
    f.link({ type: 'open' }); await f.link({ type: 'clear' })
    assert.equal(f.shape().props.url, ''); assert.equal(f.transport.getCommitCount(), 1)
    await f.session.undo(); assert.equal(f.shape().props.url, 'HTTPS://EXAMPLE.INVALID/same')
  } finally { f.close() }
})

test('四类控件可打开链接编辑，表单/展开菜单/select/组字不能发起编辑', async () => {
  const f = await setup()
  try {
    for (const owner of ['canvas', 'button', 'toolbar-button', 'anchor', 'menu-trigger']) {
      f.interaction.setInputContext({ owner })
      assert.equal(f.interaction.getLinks().canEdit, true, owner)
      f.link({ type: 'open' }); f.link({ type: 'cancel' })
    }
    for (const context of [{ owner: 'form' }, { owner: 'menu' }, { owner: 'select' }, { owner: 'menu-trigger', expanded: true }, { owner: 'button', isComposing: true }]) {
      f.interaction.setInputContext(context)
      assert.equal(f.interaction.getLinks().canEdit, false)
      assert.throws(() => f.link({ type: 'open' }))
    }
  } finally { f.close() }
})

test('表单按键和组字不能操作文档，原生 Enter 留给 form，Esc 只取消草稿', async () => {
  const f = await setup()
  try {
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/draft' })
    f.interaction.setInputContext({ owner: 'form' })
    let time = 0
    for (const key of ['Enter', 'Delete', 'k', 'z']) f.interaction.dispatch({ type: 'key_down', time: ++time, key })
    assert.equal(f.transport.getCommitCount(), 0); assert.equal(f.interaction.state.get().toolId, 'select')
    assert.ok(f.interaction.state.get().linkEditing)
    f.interaction.dispatch({ type: 'key_down', time: ++time, key: 'Escape', keyCode: 229 })
    assert.ok(f.interaction.state.get().linkEditing)
    assert.equal(f.interaction.dispatch({ type: 'key_down', time: ++time, key: 'Escape' }), true)
    assert.equal(f.interaction.state.get().linkEditing, null); assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:one'])
  } finally { f.close() }
})

for (const change of ['selection', 'tool', 'remote', 'lock', 'delete']) test(`编辑期间 ${change} 失效时保留草稿，不改新目标/新版本`, async () => {
  const f = await setup()
  try {
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/old-draft' })
    if (change === 'selection') f.interaction.select('clear')
    if (change === 'tool') f.interaction.setTool('hand')
    if (change === 'remote') await f.remote([{ type: 'set_shape_link', id: 'shape:one', url: 'https://example.invalid/remote' }])
    if (change === 'lock') await f.remote([{ type: 'update', id: 'shape:one', changes: { isLocked: true } }])
    if (change === 'delete') await f.remote([{ type: 'delete', ids: ['shape:one'] }])
    const calls = f.transport.getCommitCount(), revision = f.session.state.get().revision
    await assert.rejects(f.link({ type: 'submit' }), /变化/)
    assert.equal(f.transport.getCommitCount(), calls); assert.equal(f.session.state.get().revision, revision)
    assert.equal(f.interaction.state.get().linkEditing.url, 'example.invalid/old-draft')
    assert.notEqual(f.shape()?.props.url, 'https://example.invalid/old-draft')
    if (change === 'lock') assert.equal(f.interaction.getLinks().canEdit, false)
  } finally { f.close() }
})

test('重复提交仅发一次，取消后的迟到成功不复活弹层', async () => {
  let release
  const delay = new Promise(resolve => { release = resolve }), f = await setup({ delay })
  try {
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/once' })
    const one = f.link({ type: 'submit' }), two = f.link({ type: 'submit' })
    f.link({ type: 'cancel' }); assert.equal(f.interaction.state.get().linkEditing, null)
    release(); await Promise.all([one, two])
    assert.equal(f.transport.getCommitCount(), 1); assert.equal(f.interaction.state.get().linkEditing, null)
    await f.session.undo(); assert.equal(f.shape().props.url, '')
  } finally { release(); f.close() }
})

test('保存失败保留草稿；销毁后的迟到失败不触发状态回写', async () => {
  const f = await setup({ fail: true })
  try {
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/keep' })
    await assert.rejects(f.link({ type: 'submit' }), /合成提交失败/)
    assert.equal(f.interaction.state.get().linkEditing.url, 'example.invalid/keep')
    assert.equal(f.shape().props.url, '')
  } finally { f.close() }
  let reject
  const delay = new Promise((_, no) => { reject = no }), g = await setup({ delay })
  try {
    g.link({ type: 'open' }); g.link({ type: 'update', url: 'example.invalid/disposed' })
    const saving = g.link({ type: 'submit' })
    await Promise.resolve(); g.interaction.dispose(); reject(new Error('迟到失败'))
    await assert.rejects(saving, /迟到失败/)
    assert.equal(g.interaction.state.get().linkEditing, null)
  } finally { g.close() }
})

test('只读描述保留锁定链接、组旋转及frame裁切；删除后描述立即消失', async () => {
  const fixture = createShapeLinksFixture(), transport = memoryTransport(fixture.snapshot), session = await createEditorSession({ actor: 'links-layout', transport })
  const interaction = createCanvasInteraction({ session })
  try {
    const items = interaction.getLinks().items
    assert.ok(items.some(r => r.id === 'shape:link-locked'))
    assert.equal(items.find(r => r.id === 'shape:link-child').rotation, .5)
    assert.equal(items.find(r => r.id === 'shape:link-clipped').clips.length, 1)
    const previous = fixture.snapshot.store['shape:link-child']
    await session.commitCommands([{ type: 'update', id: 'shape:link-group', changes: { rotation: .4, isLocked: true } }])
    assert.equal(interaction.getLinks().items.find(r => r.id === previous.id).rotation, .7)
    await session.commitCommands([{ type: 'delete', ids: ['shape:link-geo'] }])
    assert.ok(!interaction.getLinks().items.some(r => r.id === 'shape:link-geo'))
  } finally { interaction.dispose(); session.dispose() }
})

test('指针移动与链接只读查询不序列化/重读全板；未变的描述复用身份', async () => {
  const f = await setup({ url: 'https://example.invalid/cached' })
  const snapshot = f.session.store.getStoreSnapshot, records = f.session.store.allRecords
  try {
    const items = f.interaction.getLinks().items
    f.session.store.getStoreSnapshot = () => { throw new Error('不许读取全板快照') }
    f.session.store.allRecords = () => { throw new Error('不许重读全板记录') }
    for (let time = 1; time <= 10; time++) {
      f.interaction.dispatch({ type: 'pointer_move', time, point: { x: time * 10, y: 20 }, buttons: 0 })
      assert.equal(f.interaction.getLinks().items, items)
    }
  } finally { f.session.store.getStoreSnapshot = snapshot; f.session.store.allRecords = records; f.close() }
})

test('私有复制编码/解码和粘贴公共接口保留组孩子的链接，不复用身份或修改来源', () => {
  const source = createShapeLinksFixture().snapshot, unchanged = structuredClone(source)
  const privateFormats = encodeClipboardContent(createClipboardContent(source, ['shape:link-group']))
  const content = decodeClipboardContent(privateFormats), destination = createCanvasSnapshot()
  const plan = planClipboardPaste(destination, content, { viewport: { x: 0, y: 0, w: 1000, h: 800 } })
  const pasted = executeCanvasCommands(destination, [{ type: 'paste_content', content, ...plan }])
  const child = Object.values(pasted.snapshot.store).find(r => r.type === 'geo' && r.props.url === 'https://example.invalid/links/child')
  assert.ok(child); assert.notEqual(child.id, 'shape:link-child'); assert.notEqual(child.parentId, 'shape:link-group')
  assert.equal(pasted.snapshot.store[child.parentId].type, 'group'); assert.deepEqual(source, unchanged)
})

test('#231 无关远端更新不打断网址草稿，同目标非网址属性变化仍拒绝', async () => {
  const f = await setup()
  try {
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/new' })
    await f.remote([{ type: 'create_shape', id: 'shape:other-231', shapeType: 'geo' }])
    await f.link({ type: 'submit' })
    assert.equal(f.shape().props.url, 'https://example.invalid/new')
    f.link({ type: 'open' }); f.link({ type: 'update', url: 'example.invalid/stale' })
    await f.remote([{ type: 'update', id: 'shape:one', changes: { x: 80 } }])
    const calls = f.transport.getCommitCount()
    await assert.rejects(f.link({ type: 'submit' }), { code: 'conflict' })
    assert.equal(f.transport.getCommitCount(), calls)
    assert.equal(f.interaction.state.get().linkEditing.url, 'example.invalid/stale')
    assert.equal(f.shape().props.url, 'https://example.invalid/new')
  } finally { f.close() }
})
