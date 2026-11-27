import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands, canvasToolRegistry } from '../engine/index.js'
import { creationFixture } from './creation-test-fixture.mjs'

test('文字会话返回画布不会取消已开始的便签续建，焦点仍归新邻居文字', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:focus-note', shapeType: 'note', x: 300, y: 300 }] })
  try {
    await f.click(400, 400); await f.click(400, 400)
    assert.equal(f.interaction.state.get().textEditing?.id, 'shape:focus-note')
    await f.key('Tab')
    const state = f.interaction.state.get()
    assert.equal(state.inputContext.owner, 'text-editing')
    assert.ok(state.textEditing); assert.notEqual(state.textEditing.id, 'shape:focus-note')
    assert.equal(f.shapes().length, 2); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

async function fixture(options = {}) {
  let snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 100, y: 100, props: { w: 200, h: 100, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 600, y: 100, props: { w: 100, h: 100 } },
  ]).snapshot
  const commits = [], history = []
  const session = await createEditorSession({ actor: 'focus-keyboard', transport: {
    read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {},
    commit: async request => { commits.push(request); const result = executeCanvasCommands(snapshot, request.commands); snapshot = result.snapshot; return { ...result, revision: String(commits.length) } },
    undo: async () => { history.push('undo'); return { snapshot, revision: 'undo' } },
    redo: async () => { history.push('redo'); return { snapshot, revision: 'redo' } },
  } })
  const interaction = createCanvasInteraction({ session, toolIds: Object.keys(canvasToolRegistry), reduceMotion: true, viewport: { w: 1280, h: 800 }, ...options })
  let time = 0
  const send = (type, extra = {}) => interaction.dispatch({ type, time: time += 16, ...extra })
  return { interaction, session, commits, history, send,
    key: (key, extra = {}, type = 'key_down') => send(type, { key, ...extra }),
    pointer: (type, x, y) => send(`pointer_${type}`, { point: { x, y }, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'up' ? 0 : 1 }),
    close: () => { interaction.dispose(); session.dispose() },
  }
}

test('非输入控件的Mod+D仍复制画布选择，而不是停在表单门槛', async () => {
  for (const owner of ['button', 'toolbar-button', 'anchor', 'menu-trigger']) {
    const f = await fixture()
    try {
      f.pointer('down', 150, 150); await f.pointer('up', 150, 150)
      f.interaction.setInputContext({ owner })
      await f.key('d', { metaKey: true })
      const ids = f.interaction.state.get().selectedIds
      assert.equal(ids.length, 1); assert.notEqual(ids[0], 'shape:a')
      assert.equal(f.session.store.get(ids[0]).x, 310)
      assert.equal(f.session.store.get('shape:a').x, 100)
      assert.equal(f.commits.length, 1)
    } finally { f.close() }
  }
})

test('工具栏Esc实际取消以后只请求一次画布焦点，repeat和keyup不重复请求', async () => {
  const requests = [], f = await fixture({ onRequestFocus: target => requests.push({ target, selected: f.interaction.state.get().selectedIds.length, mode: f.interaction.state.get().mode }) })
  try {
    f.interaction.select('all'); f.interaction.setInputContext({ owner: 'toolbar-button' })
    assert.equal(f.key('Escape'), true)
    assert.deepEqual(requests, [{ target: 'canvas', selected: 0, mode: 'idle' }])
    assert.equal(f.key('Escape', { repeat: true }), true)
    f.key('Escape', {}, 'key_up'); assert.equal(requests.length, 1)
    f.pointer('down', 150, 150); f.pointer('move', 180, 180)
    assert.equal(f.session.store.get('shape:a').x, 130)
    assert.equal(f.key('Escape'), true)
    assert.equal(f.session.store.get('shape:a').x, 100)
    assert.equal(f.session.state.get().isGestureActive, false)
    assert.equal(requests.length, 2); assert.equal(requests[1].mode, 'idle')
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('非输入控件保留激活、四方向及Space组合，不取消普通按钮上的活动指针', async () => {
  for (const owner of ['button', 'toolbar-button', 'anchor', 'menu-trigger']) {
    const f = await fixture()
    try {
      f.interaction.select('all'); f.interaction.setInputContext({ owner })
      for (const key of ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']) {
        assert.equal(f.key(key), false); assert.equal(f.key(key, { shiftKey: true, metaKey: true }), false)
        assert.equal(f.key(key, {}, 'key_up'), false)
      }
      f.key(' '); f.key('ArrowRight'); f.send('frame'); f.key(' ', {}, 'key_up')
      assert.deepEqual(f.interaction.state.get().camera, { x: 0, y: 0, z: 1 })
      assert.equal(f.interaction.state.get().temporaryTool, null)
      assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a', 'shape:b'])
      if (owner !== 'toolbar-button') {
        f.pointer('down', 150, 150); f.pointer('move', 180, 180)
        assert.equal(f.key('Escape'), false)
        assert.equal(f.session.store.get('shape:a').x, 130)
        assert.equal(f.session.state.get().isGestureActive, true)
        await f.pointer('up', 180, 180)
        assert.equal(f.commits.length, 1)
      } else assert.equal(f.commits.length, 0)
    } finally { f.close() }
  }
})

test('真实拖动中焦点从画布转到按钮仍保留预览；只有工具栏Esc才取消并回焦', async () => {
  for (const owner of ['button', 'toolbar-button', 'anchor', 'menu-trigger']) {
    const requests = [], f = await fixture({ onRequestFocus: target => requests.push(target) })
    try {
      f.pointer('down', 150, 150); f.pointer('move', 180, 180)
      f.interaction.setInputContext({ owner })
      assert.equal(f.session.store.get('shape:a').x, 130, owner)
      assert.equal(f.session.state.get().isGestureActive, true)
      if (owner === 'toolbar-button') {
        assert.equal(f.key('Escape'), true); assert.equal(f.session.store.get('shape:a').x, 100)
        assert.deepEqual(requests, ['canvas']); assert.equal(f.commits.length, 0)
      } else {
        assert.equal(f.key('Escape'), false); assert.equal(f.session.store.get('shape:a').x, 130)
        await f.pointer('up', 180, 180); assert.equal(f.commits.length, 1); assert.deepEqual(requests, [])
      }
    } finally { f.close() }
  }
})

test('细分焦点沿用工具、组合、视角、样式和历史绑定，未知键不截走原生默认', async () => {
  for (const owner of ['button', 'toolbar-button', 'anchor', 'menu-trigger']) {
    const f = await fixture()
    try {
      f.interaction.setInputContext({ owner })
      for (const [key, extra, tool] of [
        ['h', {}, 'hand'], ['d', {}, 'draw'], ['b', {}, 'draw'], ['x', {}, 'draw'], ['e', {}, 'eraser'],
        ['r', {}, 'geo'], ['o', {}, 'geo'], ['g', {}, 'geo'], ['f', {}, 'frame'], ['t', {}, 'text'],
        ['n', {}, 'note'], ['l', {}, 'line'], ['k', {}, 'laser'], ['d', { shiftKey: true }, 'highlight'], ['v', {}, 'select'],
      ]) {
        assert.equal(f.key(key, extra), true); assert.equal(f.interaction.state.get().toolId, tool)
      }
      f.interaction.select('all'); await f.key('g', { ctrlKey: true })
      assert.equal(f.session.store.get(f.interaction.state.get().selectedIds[0]).type, 'group')
      await f.key('g', { ctrlKey: true, shiftKey: true }); assert.equal(f.interaction.state.get().selectedIds.length, 2)
      f.key('=', { metaKey: true }); assert.equal(f.interaction.state.get().camera.z, 2)
      f.key('1', { shiftKey: true }); assert.notEqual(f.interaction.state.get().camera.z, 2)
      await f.key('ƒ', { altKey: true, code: 'KeyF' }); assert.equal(f.session.store.get('shape:a').props.fill, 'fill')
      await f.key('z', { metaKey: true }); await f.key('z', { ctrlKey: true, shiftKey: true }); assert.deepEqual(f.history, ['undo', 'redo'])
      assert.equal(f.key('F24'), false)
      f.key('k'); assert.equal(f.interaction.state.get().toolId, 'laser')
      f.key('v'); f.interaction.select('all'); await f.key('Backspace')
      assert.equal(f.session.store.get('shape:a'), undefined); assert.equal(f.session.store.get('shape:b'), undefined)
    } finally { f.close() }
  }
})

test('下拉、展开菜单、旧form、文字、组字与关闭开关仍保护文档，不发回焦请求', async () => {
  const requests = [], f = await fixture({ onRequestFocus: target => requests.push(target) })
  try {
    f.interaction.select('all')
    for (const context of [{ owner: 'select' }, { owner: 'menu-trigger', expanded: true }, { owner: 'menu' }, { owner: 'form' }, { owner: 'text-editing' }, { owner: 'button', isComposing: true }]) {
      f.interaction.setInputContext(context)
      for (const key of ['k', 'Delete', 'Escape', 'Enter', ' ', 'ArrowRight', 'z']) assert.equal(await f.key(key), false)
      assert.equal(await f.key('z', { metaKey: true }), false)
      assert.equal(await f.key('d', { ctrlKey: true }), false)
    }
    f.interaction.setInputContext({ owner: 'toolbar-button' })
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      assert.equal(f.key('Escape', extra), false); assert.equal(f.key('k', extra), false)
    }
    f.interaction.setShortcutsEnabled(false)
    for (const key of ['k', '=', 'Delete', ' ']) assert.equal(f.key(key), false)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a', 'shape:b'])
    assert.equal(f.commits.length, 0); assert.deepEqual(f.history, []); assert.deepEqual(requests, [])
  } finally { f.close() }
})

test('重复报告同一控件不丢Z松键；焦点变更和229清理临时状态；自带方向控件不微移', async () => {
  const f = await fixture()
  try {
    f.interaction.setInputContext({ owner: 'button' }); f.key('z')
    assert.equal(f.interaction.state.get().temporaryTool, 'zoom')
    f.interaction.setInputContext({ owner: 'button' }); assert.equal(f.interaction.state.get().temporaryTool, 'zoom')
    f.key('z', {}, 'key_up'); assert.equal(f.interaction.state.get().temporaryTool, null)
    for (const context of [{ owner: 'select' }, { owner: 'toolbar-button' }, { owner: 'button', isComposing: true }]) {
      f.interaction.setInputContext({ owner: 'canvas' }); f.key(' ')
      f.interaction.setInputContext(context); assert.equal(f.interaction.state.get().temporaryTool, null)
    }
    f.interaction.setInputContext({ owner: 'button' }); f.key('z'); f.key('k', { keyCode: 229 })
    assert.equal(f.interaction.state.get().temporaryTool, null)
    f.interaction.setInputContext({ owner: 'canvas' }); f.pointer('down', 150, 150); await f.pointer('up', 150, 150)
    f.key('ArrowRight'); assert.equal(f.session.state.get().isGestureActive, true)
    f.interaction.setInputContext({ owner: 'canvas', ownsArrows: true })
    assert.equal(f.key('ArrowRight'), false); await f.key('ArrowRight', {}, 'key_up')
    assert.equal(f.session.state.get().isGestureActive, false)
    assert.equal(f.session.store.get('shape:a').x, 100); assert.equal(f.commits.length, 0)
    assert.equal(f.key('k'), true); assert.equal(f.interaction.state.get().toolId, 'laser')
  } finally { f.close() }
})

test('提交中未处理的工具栏Esc不回焦；省略回调仍返回原有布尔结果', async () => {
  const requests = [], f = await fixture({ onRequestFocus: target => requests.push(target) })
  try {
    f.interaction.select('all'); f.interaction.setInputContext({ owner: 'toolbar-button' })
    const saving = f.key('d', { metaKey: true })
    assert.equal(f.session.state.get().isSubmitting, true)
    assert.ok(!f.key('Escape')); assert.deepEqual(requests, [])
    await saving
  } finally { f.close() }
  const old = await fixture()
  try { old.interaction.setInputContext({ owner: 'toolbar-button' }); assert.equal(old.key('Escape'), true) } finally { old.close() }
})

test('自带方向控件保留窗口捕获方向，但它明确转交小地图的同一输入仍执行一次平移', async () => {
  const f = await fixture()
  try {
    f.interaction.select('all'); f.interaction.setMinimap({ w: 152, h: 88 })
    f.interaction.setInputContext({ owner: 'canvas', ownsArrows: true })
    assert.equal(f.key('ArrowRight'), false)
    assert.deepEqual(f.interaction.state.get().camera, { x: 0, y: 0, z: 1 })
    assert.equal(f.key('ArrowRight', { target: 'minimap' }), true)
    assert.deepEqual(f.interaction.state.get().camera, { x: -40, y: 0, z: 1 })
    f.key('ArrowRight', { target: 'minimap' }, 'key_up')
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a', 'shape:b'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
