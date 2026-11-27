import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
const close = (a, b) => Math.abs(a - b) < .001
const point = (frame, x, y) => ({ x: frame.x + x * Math.cos(frame.rotation) - y * Math.sin(frame.rotation), y: frame.y + x * Math.sin(frame.rotation) + y * Math.cos(frame.rotation) })
const at = (state, id) => state.frameRecords.find(r => r.id === `shape:${id}`)
const world = (state, id) => { const r = at(state, id); return r.parentId === 'page:page' ? { x: r.x, y: r.y } : point(at(state, r.parentId.slice(6)), r.x, r.y) }
const samePoint = (a, b) => close(a.x, b.x) && close(a.y, b.y)
const handles = { top_left: [0, 0], top: [.5, 0], top_right: [1, 0], right: [1, .5], bottom_right: [1, 1], bottom: [.5, 1], bottom_left: [0, 1], left: [0, .5] }

export async function frameSmoke(target, output) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  async function until(predicate) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(25) }
    throw new Error('画框原生检查等待超时。')
  }
  let held = false
  async function pointer(type, p, modifiers = []) {
    if (type === 'mouseDown') held = true
    contents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1, modifiers: [...modifiers, ...(type === 'mouseMove' && held ? ['leftButtonDown'] : [])] })
    if (type === 'mouseUp') held = false
    await delay(25)
  }
  const click = async p => { await pointer('mouseMove', p); await pointer('mouseDown', p); await pointer('mouseUp', p) }
  const keyEvent = async (type, keyCode, modifiers = []) => { contents.sendInputEvent({ type, keyCode, modifiers }); await delay(30) }
  const key = async (keyCode, modifiers = []) => { await keyEvent('keyDown', keyCode, modifiers); await keyEvent('keyUp', keyCode, modifiers) }
  const samples = []
  const base = new URL(contents.getURL()).origin
  async function load(kind, suffix = '') {
    await target.loadURL(`${base}/?gallery=frame-interaction&frameCase=${kind}&edgeScrolling=0${suffix}`)
    await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
    return state()
  }
  async function undo(before) {
    await key('z', ['meta'])
    await until(async () => { const s = await state(); return !s.submitting && JSON.stringify(s.frameRecords) === JSON.stringify(before.frameRecords) })
  }
  let before = await load('drag')
  await pointer('mouseDown', { x: 205, y: 130 }); await pointer('mouseMove', { x: 405, y: 270 })
  let s = await state()
  check(at(s, 'a').parentId === 'shape:target' && samePoint(world(s, 'a'), { x: 300, y: 240 }) && s.revision === before.revision, '指针入框预览/保存边界错误')
  await pointer('mouseMove', { x: 770, y: 270 }); s = await state()
  check(at(s, 'a').parentId === 'page:page', '指针出框没有退出')
  await pointer('mouseMove', { x: 460, y: 270 }); await pointer('mouseUp', { x: 460, y: 270 })
  await until(async () => !(await state()).submitting)
  s = await state(); check(at(s, 'a').parentId === 'shape:target' && Number(s.revision) === Number(before.revision) + 1, '拖入没有一次提交')
  await writeFile(join(output, 'frame-enter.png'), (await contents.capturePage()).toPNG())
  await undo(before); samples.push({ dragEnterExitOneUndo: true })
  for (const kind of ['crop', 'crop-rotated']) for (const [handle, [hx, hy]] of Object.entries(handles)) {
    before = await load(kind)
    const f = at(before, 'f'), a = world(before, 'a'), locked = at(before, 'b')
    await click(point(f, 320, 220))
    await until(async () => (await state()).selectedIds[0] === 'shape:f')
    const from = point(f, hx * f.props.w, hy * f.props.h)
    const to = point(f, hx * f.props.w + (hx === .5 ? 0 : 44), hy * f.props.h + (hy === .5 ? 0 : 32))
    await pointer('mouseDown', from); await pointer('mouseMove', to)
    await keyEvent('keyDown', 'Meta', ['meta'])
    s = await state()
    check(samePoint(world(s, 'a'), a) && JSON.stringify(at(s, 'b')) === JSON.stringify(locked), `裁框补偿错误：${kind}/${handle}`)
    await pointer('mouseUp', to, ['meta']); await keyEvent('keyUp', 'Meta')
    await until(async () => !(await state()).submitting)
    check(Number((await state()).revision) === Number(before.revision) + 1, '裁框不是一次提交')
    await undo(before)
    // Command before pointerdown is the approved intentional entry difference.
    await keyEvent('keyDown', 'Meta', ['meta']); await pointer('mouseDown', from, ['meta']); await pointer('mouseMove', to, ['meta'])
    check(samePoint(world(await state(), 'a'), a), '先按Command的手柄入口未补偿')
    await key('Escape'); await pointer('mouseUp', to); await keyEvent('keyUp', 'Meta')
    check(JSON.stringify((await state()).frameRecords) === JSON.stringify(before.frameRecords), '裁框Esc未完整恢复')
    samples.push({ kind, handle, cropUndoEscape: true })
  }
  for (const enabled of [false, true]) for (const grid of [false, true]) {
    before = await load('crop', `${enabled ? '&snapping=1' : ''}${grid ? '&grid=1' : ''}`)
    await click({ x: 540, y: 400 }); await pointer('mouseDown', { x: 220, y: 310 }); await pointer('mouseMove', { x: 247, y: 310 })
    s = await state(); check(close(at(s, 'f').x, enabled ? 253 : grid ? 250 : 247), '普通对象/网格优先级错误')
    await keyEvent('keyDown', 'Meta', ['meta']); s = await state()
    check(close(at(s, 'f').x, enabled ? 247 : 253) && samePoint(world(s, 'a'), world(before, 'a')), '吸附翻转/网格绕过与裁框没有同时生效')
    await writeFile(join(output, `frame-snap-${enabled}-${grid}.png`), (await contents.capturePage()).toPNG())
    await key('Escape'); await pointer('mouseUp', { x: 247, y: 310 }); await keyEvent('keyUp', 'Meta')
    samples.push({ enabled, grid, modifierSnapAndCrop: true })
  }
  for (const [handle, x, y, expected] of [['left', 220, 310, { x: 280, y: 180, w: 300, h: 260 }], ['bottom_right', 580, 440, { x: 220, y: 180, w: 420, h: 300 }]]) {
    before = await load('crop')
    await click({ x: 540, y: 400 }); await click({ x, y })
    await pointer('mouseDown', { x, y }); await pointer('mouseMove', { x: x + 60, y: y + 40 }); await pointer('mouseUp', { x: x + 60, y: y + 40 })
    await until(async () => !(await state()).submitting)
    s = await state()
    const f = at(s, 'f')
    check(close(f.x, expected.x) && close(f.y, expected.y) && close(f.props.w, expected.w) && close(f.props.h, expected.h), '第二击拖动误执行适配')
    check(JSON.stringify(at(s, 'a')) === JSON.stringify(at(before, 'a')) && Number(s.revision) === Number(before.revision) + 1, '第二击普通缩框改变孩子或不是一次提交')
    await undo(before); samples.push({ handle, secondClickDrag: true })
  }
  for (const kind of ['fit', 'fit-rotated']) for (const [handle, [hx, hy]] of Object.entries(handles)) {
    before = await load(kind)
    const f = at(before, 'f'), a = world(before, 'a'), b = world(before, 'b')
    await click(point(f, 330, 240)); await until(async () => (await state()).selectedIds[0] === 'shape:f')
    const p = point(f, hx * f.props.w, hy * f.props.h)
    await click(p); await click(p)
    await until(async () => !(await state()).submitting && (await state()).revision !== before.revision)
    s = await state()
    check(close(at(s, 'f').props.w, hx === .5 ? 360 : 370) && close(at(s, 'f').props.h, hy === .5 ? 260 : 270), '边角适配方向/留白错误')
    check(samePoint(world(s, 'a'), a) && samePoint(world(s, 'b'), b), '适配移动了作品或锁定子项')
    check(Number(s.revision) === Number(before.revision) + 1, '双击适配不是一个事务')
    await undo(before); samples.push({ kind, handle, fitOneUndo: true })
  }
  check(!(await state()).lastError, '原生画框检查留下编辑错误')
  return { samples, isolatedMemoryOnly: true, input: 'Electron sendInputEvent; no edit API injection' }
}
