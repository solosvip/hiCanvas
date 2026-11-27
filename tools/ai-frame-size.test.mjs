import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'
import { createCanvasInteraction, createEditorSession } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const target = 'shape:target'
const identities = {
  image: { cowartAiImageHolder: true },
  draft: { cowartAiDraftHolder: true },
  film: { cowartAiDraftHolder: true, cowartAiFilmHolder: true, cowartFilmDuration: 15, cowartFilmMuted: true },
}
const presets = [
  ['1:1', 512, 512, 1], ['3:2', 768, 512, 1.5], ['2:3', 512, 768, 0.6666666666666666],
  ['4:3', 683, 512, 1.333984375], ['3:4', 512, 683, 0.7496339677891655],
  ['16:9', 1024, 576, 1.7777777777777777], ['9:16', 512, 910, 0.5626373626373626],
]
async function setup({ kind = 'image', meta = {}, commands = [], props = {}, ...options } = {}) {
  const f = await creationFixture({ ...options, commands: [
    { type: 'create_shape', id: target, shapeType: 'frame', x: 100, y: 120, props: { w: 260, h: 180, name: '合成框', color: 'blue', ...props }, meta: { ...identities[kind], retained: '原值', ...meta } },
    ...commands,
  ] })
  f.interaction.select('first')
  return { ...f, get: () => f.interaction.getAiFrameSize(), edit: action => f.interaction.editAiFrameSize(action), shape: () => f.session.store.get(target) }
}

test('三类AI框查询不可变且只读，影片同时有网页标记仍识别为影片', async () => {
  for (const kind of ['image', 'draft', 'film']) {
    const f = await setup({ kind })
    try {
      const before = f.current(), q = f.get()
      assert.equal(q.available, true); assert.equal(q.id, target); assert.equal(q.kind, kind)
      assert.deepEqual([q.w, q.h, q.locked, q.editing], [260, 180, false, false])
      assert.deepEqual(q.presets.map(p => [p.id, p.w, p.h, p.ratio]), presets)
      assert.throws(() => { q.w = 999 }, TypeError)
      assert.throws(() => { q.presets[0].w = 999 }, TypeError)
      assert.deepEqual(f.current(), before); assert.equal(f.commits.length, 0)
    } finally { f.close() }
  }
})

for (const kind of ['image', 'draft', 'film']) for (const [id, w, h, ratio] of presets) {
  test(`${kind}预设${id}只改宽高及实际比例，整次撤销重做`, async () => {
    const f = await setup({ kind, meta: { cowartAiAspectLocked: true }, commands: [
      { type: 'update', id: target, changes: { rotation: .4 } },
      { type: 'create_shape', id: 'shape:child', shapeType: 'geo', parentId: target, x: 20, y: 30 },
    ] })
    try {
      const before = f.current(), original = before.store[target], next = structuredClone(before)
      next.store[target].props.w = w; next.store[target].props.h = h; next.store[target].meta.cowartAiAspectRatio = ratio
      const defaults = f.interaction.getStyles().next
      assert.equal((await f.edit({ type: 'preset', preset: id })).status, 'applied')
      assert.deepEqual(f.current(), next)
      assert.deepEqual(f.shape().meta, { ...original.meta, cowartAiAspectRatio: ratio })
      assert.equal(f.commits.length, 1)
      assert.equal((await f.edit({ type: 'preset', preset: id })).status, 'unchanged')
      assert.equal(f.commits.length, 1)
      await f.session.undo(); assert.deepEqual(f.current(), before)
      await f.session.redo(); assert.deepEqual(f.current(), next)
      assert.deepEqual(f.interaction.getStyles().next, defaults)
    } finally { f.close() }
  })
}

test('比例锁开关取当前实际比例，关锁保留存档比值，重复动作无历史', async () => {
  const f = await setup()
  try {
    await f.edit({ type: 'lock', locked: true })
    assert.deepEqual([f.get().locked, f.get().ratio], [true, 260 / 180])
    assert.equal((await f.edit({ type: 'lock', locked: true })).status, 'unchanged')
    await f.edit({ type: 'lock', locked: false })
    assert.deepEqual([f.get().locked, f.get().ratio], [false, 260 / 180])
    await f.remote([{ type: 'update', id: target, changes: { props: { w: 400, h: 300 } } }])
    await f.edit({ type: 'lock', locked: true })
    assert.deepEqual([f.get().locked, f.get().ratio], [true, 4 / 3])
    assert.equal(f.commits.length, 3)
    assert.equal(f.shape().isLocked, false)
  } finally { f.close() }
})

test('手动草稿只在查询中预览，多次更新后一次保存撤销，不改变默认样式', async () => {
  const f = await setup()
  try {
    const before = f.current(), defaults = f.interaction.getStyles().next
    await f.edit({ type: 'lock', locked: false }); assert.equal(f.commits.length, 0)
    await f.edit({ type: 'start' })
    await f.edit({ type: 'update', w: 480.6 })
    assert.deepEqual([f.get().w, f.get().h, f.get().editing], [481, 180, true])
    await f.edit({ type: 'update', h: 99999 })
    assert.deepEqual([f.get().w, f.get().h], [481, 16384])
    f.interaction.setInputContext({ owner: 'form' })
    assert.equal(f.get().editing, true)
    assert.deepEqual(f.current(), before); assert.deepEqual(f.shape(), before.store[target]); assert.equal(f.commits.length, 0)
    assert.throws(() => { f.interaction.state.get().aiFrameSizeEditing.w = 22 }, TypeError)
    await f.edit({ type: 'update', w: .1, h: 15.9 })
    assert.deepEqual([f.get().w, f.get().h], [16, 16])
    await f.edit({ type: 'finish' })
    assert.equal(f.get().editing, false); assert.deepEqual([f.shape().props.w, f.shape().props.h], [16, 16])
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0].commands.length, 1)
    assert.deepEqual(f.interaction.getStyles().next, defaults)
    await f.session.undo(); assert.deepEqual(f.current(), before)
    await f.session.redo(); assert.deepEqual([f.shape().props.w, f.shape().props.h], [16, 16])
  } finally { f.close() }
})

test('取消和相同尺寸没有保存或历史，另一个会话不继承草稿', async () => {
  const f = await setup(), other = await setup()
  try {
    const before = f.current()
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 700 }); await f.edit({ type: 'cancel' })
    assert.deepEqual([f.get().w, f.get().editing, other.get().w, other.get().editing], [260, false, 260, false])
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 260, h: 180 })
    assert.equal((await f.edit({ type: 'finish' })).status, 'unchanged')
    assert.deepEqual(f.current(), before); assert.equal(f.commits.length, 0)
    await assert.rejects(f.session.undo())
  } finally { f.close(); other.close() }
})

for (const bad of [undefined, null, '', '500', NaN, Infinity, 0, -1, {}, []]) {
  test(`非法手输${String(bad)}连同有效轴整份拒绝，保留上次合法草稿`, async () => {
    const f = await setup()
    try {
      const before = f.current()
      await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 400 })
      await assert.rejects(f.edit({ type: 'update', w: 600, h: bad }), /有限正数/)
      assert.deepEqual([f.get().w, f.get().h], [400, 180]); assert.match(f.interaction.state.get().lastError.message, /有限正数/)
      assert.deepEqual(f.current(), before); assert.equal(f.commits.length, 0)
      await f.edit({ type: 'cancel' })
    } finally { f.close() }
  })
}

for (const [ratio, patch, expected] of [
  [2, { w: 501 }, [501, 251]], [2, { h: 300 }, [600, 300]], [2, { w: 500, h: 900 }, [500, 250]],
  [.5, { w: 16384 }, [8192, 16384]], [2, { h: 16384 }, [16384, 8192]],
  [.5, { h: 16 }, [16, 32]], [2, { w: 16 }, [32, 16]],
  [683 / 512, { w: 1366 }, [1366, 1024]], [16 / 16384, { w: 1000 }, [16, 16384]],
  [16384 / 16, { h: 1000 }, [16384, 16]],
]) {
  test(`比例${ratio}联动${JSON.stringify(patch)}保持双边范围及存档比值`, async () => {
    const f = await setup({ meta: { cowartAiAspectLocked: true, cowartAiAspectRatio: ratio } })
    try {
      await f.edit({ type: 'start' }); await f.edit({ type: 'update', ...patch })
      assert.deepEqual([f.get().w, f.get().h], expected)
      await f.edit({ type: 'finish' })
      assert.deepEqual([f.shape().props.w, f.shape().props.h], expected)
      assert.equal(f.shape().meta.cowartAiAspectRatio, ratio)
    } finally { f.close() }
  })
}

for (const ratio of [0, -1, '2', 1e-9, 1e9]) {
  test(`无效或无解存档比值${ratio}拒绝尺寸，解锁后可继续`, async () => {
    const f = await setup({ meta: { cowartAiAspectLocked: true, cowartAiAspectRatio: ratio } })
    try {
      const before = f.current()
      await f.edit({ type: 'start' })
      await assert.rejects(f.edit({ type: 'update', w: 400 }), /先解除比例锁定再改尺寸/)
      assert.deepEqual(f.current(), before); assert.equal(f.commits.length, 0)
      await f.edit({ type: 'cancel' }); await f.edit({ type: 'lock', locked: false })
      await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 400 }); await f.edit({ type: 'finish' })
      assert.equal(f.shape().props.w, 400)
    } finally { f.close() }
  })
}

for (const shapeType of ['frame', 'image', 'video', 'group']) {
  test(`普通${shapeType}不可用，不把无关选择当成AI框`, async () => {
    const f = await creationFixture({ commands: [{ type: 'create_shape', id: target, shapeType }, ...(shapeType === 'group' ? [{ type: 'create_shape', id: 'shape:child', shapeType: 'geo', parentId: target }] : [])] })
    try {
      f.interaction.select('first')
      const q = f.interaction.getAiFrameSize()
      assert.equal(q.available, false); assert.equal(q.reason, 'unsupported')
      await assert.rejects(f.interaction.editAiFrameSize({ type: 'preset', preset: '1:1' }))
      assert.equal(f.commits.length, 0)
    } finally { f.close() }
  })
}

test('Slides、多选及空选择不支持；坏动作字段不隐式写文档', async () => {
  const f = await setup({ commands: [{ type: 'create_shape', id: 'shape:slides', shapeType: 'frame', x: 700, meta: { cowartAiSlides: true, ...identities.film } }] })
  try {
    const before = f.current()
    for (const action of [null, {}, { type: 'bad' }, { type: 'toString' }, { type: 'preset', preset: 'bad' }, { type: 'lock', locked: 'yes' }, { type: 'preset', preset: '1:1', w: 9 }]) await assert.rejects(f.edit(action), /AI|未知|布尔值/)
    f.interaction.select('all'); assert.equal(f.get().reason, 'single-selection')
    await assert.rejects(f.edit({ type: 'start' }))
    f.interaction.select('next'); assert.equal(f.get().reason, 'unsupported')
    f.interaction.select('clear'); assert.equal(f.get().reason, 'single-selection')
    assert.deepEqual(f.current(), before); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

for (const cause of ['selection', 'tool', 'lock', 'hidden', 'delete', 'remote-target', 'parent-lock', 'parent-move', 'dispose']) {
  test(`${cause}使草稿失效，不把旧尺寸保存到变更后的目标`, async () => {
    const f = await setup({ commands: [
      { type: 'create_shape', id: 'shape:parent', shapeType: 'frame', x: 500 },
      { type: 'update', id: target, changes: { parentId: 'shape:parent' } },
    ] })
    try {
      f.interaction.select('child'); assert.equal(f.get().id, target)
      await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 600 })
      if (cause === 'selection') f.interaction.select('parent')
      if (cause === 'tool') f.interaction.setTool('hand')
      if (cause === 'lock') await f.remote([{ type: 'update', id: target, changes: { isLocked: true } }])
      if (cause === 'hidden') await f.remote([{ type: 'update', id: target, changes: { opacity: 0 } }])
      if (cause === 'delete') await f.remote([{ type: 'delete', ids: [target] }])
      if (cause === 'remote-target') await f.remote([{ type: 'update', id: target, changes: { props: { w: 777 } } }])
      if (cause === 'parent-lock') await f.remote([{ type: 'update', id: 'shape:parent', changes: { isLocked: true } }])
      if (cause === 'parent-move') await f.remote([{ type: 'update', id: 'shape:parent', changes: { x: 88 } }])
      if (cause === 'dispose') f.interaction.dispose()
      try { await f.edit({ type: 'finish' }) } catch {}
      assert.notEqual(f.shape()?.props.w, 600)
      assert.equal(f.commits.length, 0); assert.equal(f.session.state.get().isGestureActive, false)
      assert.equal(f.interaction.state.get().aiFrameSizeEditing, null)
    } finally { f.close() }
  })
}

test('已有手势、文字事务或文字焦点拒绝尺寸，保留原操作', async () => {
  const f = await setup()
  try {
    f.session.beginGesture()
    assert.equal(f.get().reason, 'pointer-gesture')
    await assert.rejects(f.edit({ type: 'start' }))
    assert.equal(f.session.state.get().isGestureActive, true); f.session.cancelGesture()
    f.interaction.editText({ type: 'begin', id: target })
    f.interaction.editText({ type: 'update', content: '未保存框名' })
    const text = f.interaction.state.get().textEditing
    assert.equal(f.get().reason, 'text-editing')
    await assert.rejects(f.edit({ type: 'preset', preset: '1:1' }))
    assert.deepEqual(f.interaction.state.get().textEditing, text); assert.equal(f.session.state.get().isGestureActive, true)
    await f.interaction.editText({ type: 'cancel' })
    f.interaction.setInputContext({ owner: 'text-editing' })
    await assert.rejects(f.edit({ type: 'start' })); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('裁剪拒绝尺寸且不关闭裁剪，尺寸草稿期间拒绝预设和锁', async () => {
  const f = await setup({ commands: [{ type: 'create_shape', id: 'shape:image', shapeType: 'image', x: 700 }] })
  try {
    f.interaction.select('next'); f.interaction.cropImage({ type: 'start' })
    const croppingId = f.interaction.state.get().croppingId
    assert.equal(croppingId, 'shape:image')
    await assert.rejects(f.edit({ type: 'start' })); assert.equal(f.interaction.state.get().croppingId, croppingId)
    f.interaction.cropImage({ type: 'cancel' }); f.interaction.select('first')
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 500 })
    await assert.rejects(f.edit({ type: 'preset', preset: '1:1' }), /确认或取消/)
    await assert.rejects(f.edit({ type: 'lock', locked: true }), /确认或取消/)
    assert.equal(f.get().w, 500); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('提交中重复finish共用一次保存，其他尺寸动作拒绝，选择不被恢复', async () => {
  let resume
  const gate = new Promise(resolve => { resume = resolve })
  const f = await setup({ beforeCommit: () => gate })
  try {
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 500 })
    const first = f.edit({ type: 'finish' }), second = f.edit({ type: 'finish' })
    assert.equal(f.session.state.get().isSubmitting, true)
    await assert.rejects(f.edit({ type: 'start' }), /正在提交/)
    await assert.rejects(f.edit({ type: 'cancel' }), /正在提交/)
    assert.equal(f.get().reason, 'submitting')
    resume(); await Promise.all([first, second])
    assert.equal(f.commits.length, 1); assert.equal(f.shape().props.w, 500)
    assert.deepEqual(f.interaction.state.get().selectedIds, [target])
  } finally { resume(); f.close() }
})

test('保存失败保留完整草稿，可原样重试，不产生半次文档或空历史', async () => {
  let fail = true
  const f = await setup({ beforeCommit: () => { if (fail) { fail = false; throw new Error('模拟尺寸保存失败') } } })
  try {
    const before = f.current(), defaults = f.interaction.getStyles().next
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 600, h: 700 })
    await assert.rejects(f.edit({ type: 'finish' }), /模拟尺寸保存失败/)
    assert.deepEqual(f.current(), before); assert.deepEqual(f.shape(), before.store[target])
    assert.deepEqual([f.get().w, f.get().h, f.get().editing], [600, 700, true])
    assert.match(f.interaction.state.get().lastError.message, /模拟尺寸保存失败/)
    await f.edit({ type: 'finish' }); await f.session.undo()
    assert.deepEqual(f.current(), before); assert.deepEqual(f.interaction.getStyles().next, defaults)
    await assert.rejects(f.session.undo())
  } finally { f.close() }
})

for (const remote of ['target', 'parent-lock', 'delete', 'unrelated']) {
  test(`409遇到远端${remote}只提交一次并保留远端，不自动重放`, async () => {
    let f, once = true
    f = await setup({ commands: [{ type: 'create_shape', id: 'shape:parent', shapeType: 'frame', x: 700 }, { type: 'update', id: target, changes: { parentId: 'shape:parent' } }, { type: 'create_shape', id: 'shape:other', shapeType: 'geo', x: 1100 }],
      beforeCommit: async () => {
        if (!once) return; once = false
        await f.remote(remote === 'delete' ? [{ type: 'delete', ids: [target] }] : [{ type: 'update', id: remote === 'target' ? target : remote === 'unrelated' ? 'shape:other' : 'shape:parent', changes: remote === 'parent-lock' ? { isLocked: true } : { meta: { remote: true } } }], false)
      } })
    try {
      f.interaction.select('child')
      await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 600 })
      await assert.rejects(f.edit({ type: 'finish' }), /conflict/i)
      assert.equal(f.commits.length, 1); assert.notEqual(f.shape()?.props.w, 600)
      assert.deepEqual(f.shape(), f.current().store[target]); assert.equal(f.session.state.get().isGestureActive, false)
      assert.equal(f.get().editing ?? false, remote === 'unrelated')
      if (remote === 'target') assert.equal(f.shape().meta.remote, true)
      if (remote === 'parent-lock') assert.equal(f.session.store.get('shape:parent').isLocked, true)
      if (remote === 'unrelated') {
        await f.edit({ type: 'finish' }); assert.equal(f.shape().props.w, 600)
        assert.equal(f.session.store.get('shape:other').meta.remote, true); assert.equal(f.commits.length, 2)
      }
      await f.edit({ type: 'cancel' })
    } finally { f.close() }
  })
}

test('嵌套旋转框、远端孩子和相机变化不被尺寸提交覆盖', async () => {
  const f = await setup({ commands: [
    { type: 'create_shape', id: 'shape:parent', shapeType: 'frame', x: 400, y: 40, rotation: .3 },
    { type: 'update', id: target, changes: { parentId: 'shape:parent', rotation: .4 } },
    { type: 'create_shape', id: 'shape:child', shapeType: 'geo', parentId: target, x: 40, y: 50 },
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 700, y: 500 },
    { type: 'put', record: { id: 'binding:child', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:child', props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: true, isPrecise: true, snap: 'none' }, meta: {} } },
  ] })
  try {
    f.interaction.select('child'); const original = f.shape()
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 600, h: 900 })
    f.interaction.setCamera({ x: 80, y: -60, z: 2 })
    await f.remote([{ type: 'update', id: 'shape:child', changes: { x: 80, meta: { remote: true } } }])
    const child = f.session.store.get('shape:child'), parent = f.session.store.get('shape:parent'), binding = f.session.store.get('binding:child'), arrow = f.session.store.get('shape:arrow')
    await f.edit({ type: 'finish' })
    assert.deepEqual(f.shape(), { ...original, props: { ...original.props, w: 600, h: 900 } })
    assert.deepEqual(f.session.store.get('shape:child'), child); assert.deepEqual(f.session.store.get('shape:parent'), parent)
    assert.deepEqual(f.session.store.get('binding:child'), binding); assert.deepEqual(f.session.store.get('shape:arrow'), arrow)
    assert.deepEqual(f.interaction.state.get().camera, { x: 80, y: -60, z: 2 })
  } finally { f.close() }
})

test('尺寸与比例锁序列化保存后，重建运行时仍读取文档值', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-size-')), f = await setup({ kind: 'film' })
  let session, interaction
  try {
    await f.edit({ type: 'preset', preset: '9:16' }); await f.edit({ type: 'lock', locked: true })
    const expected = f.get(), file = path.join(dir, 'synthetic-canvas.json')
    await writeFile(file, JSON.stringify(f.current())); f.close()
    session = await createEditorSession({ actor: 'reopened', transport: memoryTransport(JSON.parse(await readFile(file, 'utf8'))) })
    interaction = createCanvasInteraction({ session }); interaction.select('first')
    const actual = interaction.getAiFrameSize()
    assert.deepEqual([actual.kind, actual.w, actual.h, actual.locked, actual.ratio], [expected.kind, expected.w, expected.h, expected.locked, expected.ratio])
    assert.equal(session.store.get(target).meta.cowartFilmDuration, 15)
  } finally { interaction?.dispose(); session?.dispose(); f.close(); await rm(dir, { recursive: true, force: true }) }
})

test('外部提交占用期间拒绝所有尺寸写操作，不取消外部提交', async () => {
  let resume
  const gate = new Promise(resolve => { resume = resolve })
  const f = await setup({ beforeCommit: () => gate })
  try {
    const pending = f.session.commitCommands([{ type: 'update', id: target, changes: { meta: { external: true } } }])
    for (const action of [{ type: 'start' }, { type: 'preset', preset: '1:1' }, { type: 'lock', locked: true }]) await assert.rejects(f.edit(action))
    assert.equal(f.session.state.get().isSubmitting, true)
    resume(); await pending
    assert.equal(f.shape().meta.external, true); assert.equal(f.shape().props.w, 260); assert.equal(f.commits.length, 1)
  } finally { resume(); f.close() }
})

test('确认期间销毁交互不另写或撤回已经发送的事务', async () => {
  let resume
  const gate = new Promise(resolve => { resume = resolve })
  const f = await setup({ beforeCommit: () => gate })
  try {
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 500 })
    const pending = f.edit({ type: 'finish' }); f.interaction.dispose()
    resume(); await pending
    assert.equal(f.commits.length, 1); assert.equal(f.shape().props.w, 500)
    await f.session.undo(); assert.equal(f.shape().props.w, 260)
  } finally { resume(); f.close() }
})

test('坏存档的对象比例不从只读查询泄露文档对象，仍能解锁恢复', async () => {
  const f = await setup({ meta: { cowartAiAspectLocked: true, cowartAiAspectRatio: { damaged: true } } })
  try {
    const before = f.current()
    assert.equal(f.get().ratio, null); assert.deepEqual(f.current(), before)
    await f.edit({ type: 'start' }); await assert.rejects(f.edit({ type: 'update', w: 500 }), /先解除比例锁定再改尺寸/)
    await f.edit({ type: 'cancel' }); await f.edit({ type: 'lock', locked: false }); await f.edit({ type: 'lock', locked: true })
    assert.equal(f.get().ratio, 260 / 180)
  } finally { f.close() }
})

test('尺寸草稿遇到外部手势时明确拒绝更新/确认，保留两边操作', async () => {
  const f = await setup()
  try {
    await f.edit({ type: 'start' }); await f.edit({ type: 'update', w: 500 })
    f.session.beginGesture()
    await assert.rejects(f.edit({ type: 'finish' }), /结束当前操作/)
    await assert.rejects(f.edit({ type: 'update', h: 600 }), /结束当前操作/)
    assert.equal(f.session.state.get().isGestureActive, true)
    assert.deepEqual([f.get().w, f.get().h, f.get().editing], [500, 180, true]); assert.equal(f.commits.length, 0)
    f.session.cancelGesture(); await f.edit({ type: 'finish' })
    assert.equal(f.shape().props.w, 500); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})
