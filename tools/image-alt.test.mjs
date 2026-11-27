import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasInteraction, createEditorSession, executeCanvasCommands } from '../engine/index.js'
import { createImageGallery } from './renderer-preview/image-fixtures.js'
import { memoryTransport } from './renderer-preview/transport.js'

async function setup() {
  let time = 0, failOnce = false
  const transport = memoryTransport(createImageGallery(undefined, true).snapshot), commit = transport.commit
  const commits = []
  transport.commit = async request => { commits.push(request); if (failOnce) { failOnce = false; throw new Error('模拟保存失败') }; return commit(request) }
  const session = await createEditorSession({ actor: 'image-alt', transport })
  const interaction = createCanvasInteraction({ session, edgeScrolling: false })
  const input = value => interaction.dispatch({ time: ++time, ...value })
  await input({ type: 'pointer_down', point: { x: 220, y: 210 }, button: 0, buttons: 1 })
  await input({ type: 'pointer_up', point: { x: 220, y: 210 }, button: 0, buttons: 0 })
  return { session, interaction, commits, input, alt: action => interaction.imageAlt(action),
    failNext: () => { failOnce = true },
    shape: () => session.store.get('shape:image-0'),
    remote: async commands => { await commit({ expectedRevision: session.state.get().revision, commands, actor: 'remote' }); await session.refresh() },
    close: () => { interaction.dispose(); session.dispose() } }
}
for (const method of ['finish', 'Enter', 'outside']) test(`替代文字草稿不写Store，${method}一次提交、一次撤销`, async () => {
  const f = await setup()
  try {
    f.alt({ type: 'start' }); f.alt({ type: 'update', text: '第一段' }); f.alt({ type: 'update', text: '图片：<文字> & 描述' })
    assert.equal(f.shape().props.altText, '')
    assert.equal(f.commits.length, 0)
    if (method === 'finish') await f.alt({ type: 'finish' })
    else if (method === 'Enter') await f.input({ type: 'key_down', key: 'Enter' })
    else await f.input({ type: 'pointer_down', point: { x: 800, y: 600 }, button: 0, buttons: 1 })
    assert.equal(f.shape().props.altText, '图片：<文字> & 描述')
    assert.equal(f.commits.length, 1)
    assert.equal(f.interaction.state.get().imageAltEditing, null)
    assert.equal(f.commits[0].commands.length, 1)
    assert.ok(!JSON.stringify(f.commits).includes('imageAltEditing'))
    await f.session.undo(); assert.equal(f.shape().props.altText, '')
    await f.session.redo(); assert.equal(f.shape().props.altText, '图片：<文字> & 描述')
  } finally { f.close() }
})
test('Escape取消、输入法Enter不提交、没改文字不产生记录', async () => {
  const f = await setup()
  try {
    f.alt({ type: 'start' }); f.alt({ type: 'update', text: '未确认' })
    f.input({ type: 'key_down', key: 'Enter', isComposing: true })
    assert.equal(f.commits.length, 0); assert.ok(f.interaction.state.get().imageAltEditing)
    await f.input({ type: 'key_down', key: 'Escape' })
    assert.equal(f.shape().props.altText, ''); assert.equal(f.commits.length, 0)
    f.alt({ type: 'start' }); await f.alt({ type: 'finish' }); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
test('远端修改/锁定、选择变化与销毁均不会把描述草稿写回', async () => {
  for (const action of ['update', 'lock', 'select', 'dispose']) {
    const f = await setup()
    try {
      f.alt({ type: 'start' }); f.alt({ type: 'update', text: '旧草稿' })
      if (action === 'update') await f.remote([{ type: 'set_image_alt_text', id: 'shape:image-0', altText: '远端描述' }])
      if (action === 'lock') await f.remote([{ type: 'update', id: 'shape:image-0', changes: { isLocked: true } }])
      if (action === 'select') f.interaction.select('clear')
      if (action === 'dispose') f.interaction.dispose()
      try { await f.alt({ type: 'finish' }) } catch {}
      assert.notEqual(f.shape().props.altText, '旧草稿', action)
      assert.equal(f.commits.length, 0, action)
    } finally { f.close() }
  }
})
test('命令拒绝锁定的图片与过长描述，整批回滚', async () => {
  const f = await setup()
  try {
    const snapshot = { store: Object.fromEntries(f.session.store.allRecords().map(r => [r.id, r])), schema: f.session.store.getStoreSnapshot().schema }
    assert.throws(() => executeCanvasCommands(snapshot, [{ type: 'set_image_alt_text', id: 'shape:image-0', altText: 'x'.repeat(10001) }]))
    await f.remote([{ type: 'update', id: 'shape:image-0', changes: { isLocked: true } }])
    assert.throws(() => f.alt({ type: 'start' }), /锁定|选择/)
  } finally { f.close() }
})
test('描述提交失败保留草稿，恢复后可以原样重试', async () => {
  const f = await setup()
  try {
    f.alt({ type: 'start' }); f.alt({ type: 'update', text: '不能丢失的描述' }); f.failNext()
    await assert.rejects(f.alt({ type: 'finish' }), /模拟保存失败/)
    assert.equal(f.shape().props.altText, '')
    assert.equal(f.interaction.state.get().imageAltEditing?.text, '不能丢失的描述')
    await f.alt({ type: 'finish' })
    assert.equal(f.shape().props.altText, '不能丢失的描述')
    assert.equal(f.interaction.state.get().imageAltEditing, null)
    await f.session.undo(); assert.equal(f.shape().props.altText, '')
  } finally { f.close() }
})
