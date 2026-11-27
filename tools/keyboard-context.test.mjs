import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { attachPreviewInput } from './renderer-preview/input.js'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'

async function fixture(options = {}) {
  let snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 100, y: 100, props: { w: 200, h: 100, fill: 'solid' } }]).snapshot
  const commits = [], history = []
  const session = await createEditorSession({ actor: 'keyboard-context', transport: {
    read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {},
    commit: async request => { commits.push(request); const result = executeCanvasCommands(snapshot, request.commands); snapshot = result.snapshot; return { ...result, revision: String(commits.length) } },
    undo: async () => { history.push('undo'); return { snapshot, revision: 'undo' } },
    redo: async () => { history.push('redo'); return { snapshot, revision: 'redo' } },
  } })
  const interaction = createCanvasInteraction({ session, viewport: { w: 1280, h: 800 }, ...options })
  let time = 0
  const send = (type, extra = {}, dt = 16) => interaction.dispatch({ type, time: time += dt, ...extra })
  return { session, interaction, commits, history, send,
    key: (key, extra = {}, type = 'key_down') => send(type, { key, ...extra }),
    pointer: (type, x, y, extra = {}) => send(`pointer_${type}`, { point: { x, y }, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'up' ? 0 : 1, ...extra }),
    frame: (dt = 16) => send('frame', {}, dt),
    camera: () => interaction.state.get().camera,
    close: () => { interaction.dispose(); session.dispose() },
  }
}

test('三个样式快捷键共用样式API，Option字符按物理code识别且重复不是开关', async () => {
  const f = await fixture()
  try {
    f.interaction.select('all')
    await f.key('†', { code: 'KeyT', altKey: true })
    assert.equal(f.session.store.get('shape:a').props.color, 'white')
    assert.equal(f.interaction.getStyles().next.color, 'white')
    await f.key('ƒ', { code: 'KeyF', altKey: true })
    assert.equal(f.session.store.get('shape:a').props.fill, 'fill')
    await f.key('F', { code: 'KeyF', altKey: true, shiftKey: true })
    assert.equal(f.session.store.get('shape:a').props.fill, 'lined-fill')
    assert.equal(f.commits.length, 3)
    await f.key('F', { code: 'KeyF', altKey: true, shiftKey: true })
    assert.equal(f.commits.length, 3)
    assert.equal(f.session.store.get('shape:a').props.fill, 'lined-fill')
    f.interaction.select('clear')
    await f.key('f', { altKey: true })
    assert.equal(f.interaction.getStyles().next.fill, 'fill')
    assert.equal(f.commits.length, 3, '无选择的快捷键只更新会话')
  } finally { f.close() }
})

test('样式快捷键不截走表单、菜单、文字、组字或禁用输入，也不取消进行中的拖动', async () => {
  const f = await fixture()
  try {
    f.interaction.select('all')
    const before = f.interaction.getStyles().next
    const keys = [['†', { code: 'KeyT', altKey: true }], ['ƒ', { code: 'KeyF', altKey: true }], ['F', { code: 'KeyF', altKey: true, shiftKey: true }]]
    for (const owner of ['form', 'menu', 'text-editing']) {
      f.interaction.setInputContext({ owner })
      for (const [key, extra] of keys) assert.equal(await f.key(key, extra), false)
    }
    f.interaction.setInputContext({ owner: 'canvas' })
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { metaKey: true }, { ctrlKey: true }]) for (const [key, binding] of keys) await f.key(key, { ...binding, ...extra })
    f.interaction.setInputContext({ owner: 'canvas', isComposing: true })
    for (const [key, extra] of keys) await f.key(key, extra)
    f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setShortcutsEnabled(false)
    for (const [key, extra] of keys) await f.key(key, extra)
    f.interaction.setShortcutsEnabled(true)
    assert.deepEqual(f.interaction.getStyles().next, before)
    assert.equal(f.commits.length, 0)
    f.pointer('down', 150, 150); f.pointer('move', 180, 180)
    for (const [key, extra] of keys) await f.key(key, extra)
    assert.equal(f.session.state.get().isGestureActive, true)
    assert.equal(f.session.store.get('shape:a').props.color, 'black')
    await f.pointer('up', 180, 180)
    assert.equal(f.commits.length, 1)
    assert.deepEqual(f.interaction.getStyles().next, before)
  } finally { f.close() }
})

for (const owner of ['form', 'menu', 'text-editing']) test(`输入归 ${owner} 时，工具、视角及撤销按键都不落到画布；切回后恢复`, async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    f.interaction.setInputContext({ owner })
    for (const [key, extra] of [['h', {}], ['=', {}], ['1', { shiftKey: true }], ['z', {}], [' ', {}], ['z', { metaKey: true }], ['z', { ctrlKey: true, shiftKey: true }]]) {
      await f.key(key, extra); f.frame(); await f.key(key, extra, 'key_up')
      assert.equal(f.interaction.state.get().toolId, 'select'); assert.equal(f.interaction.state.get().temporaryTool, null)
      assert.deepEqual(f.camera(), { x: 0, y: 0, z: 1 }); assert.deepEqual(f.history, [])
    }
    f.interaction.setInputContext({ owner: 'canvas' }); f.key('h'); assert.equal(f.interaction.state.get().toolId, 'hand')
    f.key('='); assert.equal(f.camera().z, 2); await f.key('z', { metaKey: true }); assert.deepEqual(f.history, ['undo'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('组字上下文、KeyboardEvent.isComposing 和 229 保护均先于工具、视角及撤销分派', async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    for (const source of ['context', 'event', '229']) {
      if (source === 'context') f.interaction.setInputContext({ owner: 'canvas', isComposing: true })
      const extra = source === 'event' ? { isComposing: true } : source === '229' ? { keyCode: 229 } : {}
      for (const key of ['h', '=', ' ', 'z', ',']) { await f.key(key, extra); f.frame(); await f.key(key, extra, 'key_up') }
      await f.key('z', { ...extra, metaKey: true })
      assert.equal(f.interaction.state.get().toolId, 'select'); assert.equal(f.interaction.state.get().temporaryTool, null)
      assert.deepEqual(f.camera(), { x: 0, y: 0, z: 1 }); assert.deepEqual(f.history, [])
      f.interaction.setInputContext({ owner: 'canvas', isComposing: false })
    }
    f.key('h'); assert.equal(f.interaction.state.get().toolId, 'hand'); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('快捷键开关只留在本窗口，关闭后不改工具、相机或历史；按钮与真实指针仍可用', async () => {
  const f = await fixture({ shortcutsEnabled: false, reduceMotion: true }), other = await fixture()
  try {
    assert.equal(f.interaction.state.get().shortcutsEnabled, false)
    for (const key of ['h', '=', 'z', ' ', ',']) { await f.key(key); f.frame(); await f.key(key, {}, 'key_up') }
    await f.key('z', { ctrlKey: true }); assert.deepEqual(f.history, [])
    assert.equal(f.interaction.state.get().toolId, 'select'); assert.deepEqual(f.camera(), { x: 0, y: 0, z: 1 })
    f.pointer('down', 150, 150); await f.pointer('up', 150, 150); assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    f.interaction.navigate('zoom-in'); assert.equal(f.camera().z, 2)
    assert.equal(other.interaction.state.get().shortcutsEnabled, true)
    f.interaction.setShortcutsEnabled(true); f.key('h'); assert.equal(f.interaction.state.get().toolId, 'hand')
    assert.equal(f.commits.length, 0)
    assert.ok(!JSON.stringify(f.session.store.getStoreSnapshot()).includes('shortcutsEnabled'))
  } finally { f.close(); other.close() }
})

test('焦点转移、开始组字或关闭快捷键会释放临时工具，丢失的 keyup 不会卡住空格或 Z', async () => {
  const f = await fixture()
  try {
    for (const key of [' ', 'z']) for (const reason of ['form', 'menu', 'composition', 'switch']) {
      f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setShortcutsEnabled(true)
      f.key(key); assert.ok(f.interaction.state.get().temporaryTool)
      if (reason === 'switch') f.interaction.setShortcutsEnabled(false)
      else f.interaction.setInputContext({ owner: reason === 'composition' ? 'canvas' : reason, isComposing: reason === 'composition' })
      assert.equal(f.interaction.state.get().temporaryTool, null)
      f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setShortcutsEnabled(true)
      f.pointer('down', 600, 300); f.pointer('move', 620, 310); await f.pointer('up', 620, 310)
      assert.deepEqual(f.camera(), { x: 0, y: 0, z: 1 })
    }
  } finally { f.close() }
})


test('宿主只报告焦点和组字；表单、菜单保留原生按键，画布绑定才阻止默认行为，卸载移除监听', async () => {
  const f = await fixture({ reduceMotion: true }), keys = new EventTarget(), host = new EventTarget(), errors = []
  const doc = { defaultView: keys, activeElement: host }
  host.ownerDocument = doc; host.clientWidth = 1280; host.clientHeight = 800
  host.contains = target => target === host; host.closest = () => null
  const target = owner => owner === 'canvas' ? host : { closest: selector => {
    if (owner === 'form' && selector.startsWith('input,')) return {}
    if (owner === 'menu' && selector.includes('[role="menu"]')) return {}
    return null
  } }
  const event = (type, element, properties = {}) => {
    const value = new Event(type, { cancelable: true })
    for (const [key, data] of Object.entries({ target: element, ...properties })) Object.defineProperty(value, key, { value: data })
    keys.dispatchEvent(value); return value
  }
  const focus = owner => { doc.activeElement = target(owner); event('focusin', doc.activeElement) }
  const key = (key, extra = {}) => {
    const result = event('keydown', doc.activeElement, { key, ...extra })
    event('keyup', doc.activeElement, { key, ...extra }); return result
  }
  const controls = attachPreviewInput(host, f.interaction, { onError: error => errors.push(error.message) })
  try {
    for (const owner of ['form', 'menu']) {
      focus(owner); assert.equal(key('h').defaultPrevented, false)
      assert.equal(key('=', { ctrlKey: true }).defaultPrevented, false)
      assert.equal(key('z', { metaKey: true }).defaultPrevented, false)
      assert.equal(f.interaction.state.get().inputContext.owner, owner)
      assert.equal(f.interaction.state.get().toolId, 'select'); assert.equal(f.camera().z, 1)
    }
    focus('canvas'); event('compositionstart', host)
    assert.equal(key('h').defaultPrevented, false); assert.equal(key('=').defaultPrevented, false)
    assert.equal(f.interaction.state.get().toolId, 'select'); assert.equal(f.camera().z, 1)
    event('compositionend', host)
    assert.equal(key('h', { isComposing: true }).defaultPrevented, false)
    assert.equal(key('h', { keyCode: 229 }).defaultPrevented, false)
    assert.equal(key('h').defaultPrevented, true); assert.equal(f.interaction.state.get().toolId, 'hand')
    assert.equal(key('F8').defaultPrevented, false)
    f.interaction.setShortcutsEnabled(false); assert.equal(key('=').defaultPrevented, false); assert.equal(f.camera().z, 1)
    f.interaction.setShortcutsEnabled(true)
    event('keydown', host, { key: ' ' }); assert.equal(f.interaction.state.get().temporaryTool, 'hand')
    event('blur', keys); assert.equal(f.interaction.state.get().temporaryTool, null)
    assert.deepEqual(f.history, []); assert.deepEqual(errors, [])
    controls.dispose(); focus('canvas'); key('='); assert.equal(f.camera().z, 1)
  } finally { controls.dispose(); f.close() }
})


test('焦点在自带方向键的画布控件（小地图）上时，方向键只交给控件，不微移选中形状；其他画布快捷键照常', async () => {
  const f = await fixture(), keys = new EventTarget(), host = new EventTarget()
  const doc = { defaultView: keys, activeElement: host }
  host.ownerDocument = doc; host.clientWidth = 1280; host.clientHeight = 800
  host.contains = target => target === host; host.closest = () => null
  // The minimap is a canvas-owned control outside the host that dispatches its
  // own arrow keys (#98); the host's window-level capture listener sees them first.
  const minimap = { closest: selector => selector === '[data-canvas-input-owner="canvas"]' || selector === '[data-canvas-own-arrows]' ? {} : null }
  const event = (type, element, properties = {}) => {
    const value = new Event(type, { cancelable: true })
    for (const [key, data] of Object.entries({ target: element, ...properties })) Object.defineProperty(value, key, { value: data })
    keys.dispatchEvent(value); return value
  }
  const controls = attachPreviewInput(host, f.interaction)
  try {
    f.pointer('down', 150, 150); f.pointer('up', 150, 150)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    doc.activeElement = minimap; event('focusin', minimap)
    assert.equal(event('keydown', minimap, { key: 'ArrowRight', code: 'ArrowRight' }).defaultPrevented, false)
    assert.equal(f.session.state.get().isGestureActive, false)
    event('keyup', minimap, { key: 'ArrowRight', code: 'ArrowRight' }); await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(f.session.store.get('shape:a').x, 100); assert.equal(f.commits.length, 0)
    assert.equal(event('keydown', minimap, { key: 'h' }).defaultPrevented, true)
    assert.equal(f.interaction.state.get().toolId, 'hand')
  } finally { controls.dispose(); f.close() }
})

test('I09：逗号在最近指针处按下、移动预览、松键整次保存；重复按下和放大视角不多记事务', async () => {
  for (const z of [1, 2]) {
    const f = await fixture({ camera: { x: 0, y: 0, z } })
    try {
      f.pointer('move', 150 * z, 150 * z, { buttons: 0 })
      f.key(',', { code: 'Comma' }); assert.equal(f.interaction.state.get().mode, 'pointing')
      assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
      f.key(',', { repeat: true }); f.key(',')
      f.pointer('move', 180 * z, 170 * z, { buttons: 0 })
      assert.equal(f.session.store.get('shape:a').x, 130); assert.equal(f.commits.length, 0)
      f.frame(); assert.equal(f.commits.length, 0)
      await f.key(',', {}, 'key_up')
      assert.equal(f.commits.length, 1); assert.equal(f.commits[0].commands.length, 1)
      assert.equal(f.session.store.get('shape:a').y, 120); assert.equal(f.interaction.state.get().mode, 'idle')
      await f.key(',', {}, 'key_up'); assert.equal(f.commits.length, 1)
    } finally { f.close() }
  }
})

test('I09：逗号支持框选与手形；Esc、焦点转移、组字和关闭快捷键取消预览并释放模拟指针', async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    f.pointer('move', 50, 50, { buttons: 0 }); f.key(','); f.pointer('move', 120, 120, { buttons: 0 })
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a']); await f.key(',', {}, 'key_up')
    f.key('h'); f.pointer('move', 500, 300, { buttons: 0 }); f.key(','); f.pointer('move', 520, 310, { buttons: 0 }); await f.key(',', {}, 'key_up')
    assert.deepEqual(f.camera(), { x: 20, y: 10, z: 1 }); assert.equal(f.commits.length, 0)
    f.key('v'); f.interaction.setCamera({ x: 0, y: 0, z: 1 })
    for (const reason of ['escape', 'focus', 'ime', 'switch']) {
      f.pointer('move', 150, 150, { buttons: 0 }); f.key(','); f.pointer('move', 180, 170, { buttons: 0 })
      assert.equal(f.session.store.get('shape:a').x, 130)
      if (reason === 'escape') f.key('Escape')
      if (reason === 'focus') f.interaction.setInputContext({ owner: 'form' })
      if (reason === 'ime') f.key('h', { isComposing: true })
      if (reason === 'switch') f.interaction.setShortcutsEnabled(false)
      assert.equal(f.session.store.get('shape:a').x, 100); assert.equal(f.session.state.get().isGestureActive, false)
      f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setShortcutsEnabled(true)
      await f.key(',', {}, 'key_up'); assert.equal(f.commits.length, 0)
    }
    f.pointer('down', 150, 150); f.key(','); f.pointer('move', 180, 170); await f.key(',', {}, 'key_up')
    assert.equal(f.commits.length, 0, '真实指针手势不得被逗号松键提交')
    await f.pointer('up', 180, 170); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('I10/H24：空格方向键按视口尺寸和缩放平移，普通快捷键关闭后仍可用，选择与文档不变', async () => {
  for (const shortcutsEnabled of [true, false]) for (const z of [.5, 1, 2]) {
    const f = await fixture({ shortcutsEnabled, reduceMotion: true })
    try {
      f.pointer('down', 150, 150); await f.pointer('up', 150, 150)
      for (const [key, x, y] of [['ArrowRight', -1280, 0], ['ArrowLeft', 1280, 0], ['ArrowDown', 0, -800], ['ArrowUp', 0, 800]]) {
        f.interaction.setCamera({ x: 10, y: 20, z }); f.key(key); assert.deepEqual(f.camera(), { x: 10, y: 20, z })
        f.key(' ', { code: 'Space' }); f.key(key)
        assert.deepEqual(f.camera(), { x: 10 + x / z, y: 20 + y / z, z })
        f.key(key, {}, 'key_up'); f.key(' ', {}, 'key_up')
        assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a']); assert.equal(f.commits.length, 0)
      }
    } finally { f.close() }
  }
})

test('I10：320ms 三次缓入缓出由帧输入推进；松键继续过渡，重复键从当前相机再走一个视口', async () => {
  const f = await fixture()
  try {
    f.key(' '); f.key('ArrowRight'); assert.deepEqual(f.camera(), { x: 0, y: 0, z: 1 })
    for (const x of [-80, -640]) { f.frame(80); assert.equal(f.camera().x, x) }
    f.key('ArrowRight', {}, 'key_up'); f.key(' ', {}, 'key_up')
    f.frame(48); assert.equal(f.camera().x, -1200)
    f.frame(80); assert.equal(f.camera().x, -1280); assert.equal(f.interaction.state.get().needsFrame, false)
    f.key(' '); f.key('ArrowDown'); f.frame(80); const y = f.camera().y
    f.key('ArrowDown', { repeat: true }); f.frame(320); assert.equal(f.camera().y, y - 800)
    f.interaction.setInputContext({ owner: 'menu' }); const stopped = f.camera(); f.frame(320); assert.deepEqual(f.camera(), stopped)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
