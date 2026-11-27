import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// All edits use native input. JS sets up only synthetic camera/background and
// reads state/DOM. Color expectations come from an independent legacy capture.
export async function eraserSmoke(window, output, colorOnly = false) {
  // Two independent legacy white-canvas native captures, 2026-11-27.
  // Screenshot composite pixels, not unpremultiplied Canvas RGBA.
  const expected = { head: [246, 246, 246] }
  const wc = window.webContents, origin = new URL(wc.getURL()).origin, samples = []
  const evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  let assertions = 0
  const check = (condition, message) => { assertions++; if (!condition) throw new Error(message) }
  const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  let held = false
  async function until(predicate) {
    const end = Date.now() + 10000
    while (Date.now() < end) { const value = await state(); if (value?.error) throw new Error(value.error); if (await predicate(value)) return value; await delay(10) }
    throw new Error('等待橡皮擦原生结果超时')
  }
  const mouse = async (type, x, y, modifiers = []) => {
    if (type === 'mouseDown') held = true
    wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: [...modifiers, ...(type === 'mouseMove' && held ? ['leftButtonDown'] : [])] })
    if (type === 'mouseUp') held = false
    await flush()
  }
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers })
    await flush()
  }
  const click = async (x, y, modifiers = []) => { await mouse('mouseDown', x, y, modifiers); await mouse('mouseUp', x, y, modifiers); await until(s => !s.submitting) }
  const load = async (mode = 'multi', query = '') => {
    await window.loadURL(`${origin}/?gallery=eraser&eraseCase=${mode}&edgeScrolling=0${query}`)
    await until(s => s?.ready)
    await evaluate("document.querySelector('#canvas').style.backgroundColor='#fff';document.querySelector('#canvas').focus();void 0")
    await flush(); held = false
  }
  const ids = s => s.eraserRecords.map(r => r.id).sort()
  const equal = (actual, wanted, label) => check(JSON.stringify(actual) === JSON.stringify(wanted), `${label}: ${JSON.stringify(actual)}`)
  const remember = async label => { const s = await state(); samples.push({ label, ...s }); return s }
  async function capture(label, points) {
    const image = await wc.capturePage(), bytes = image.toBitmap(), size = image.getSize()
    const viewport = await evaluate('({w:innerWidth,h:innerHeight})'), sx = size.width / viewport.w, sy = size.height / viewport.h
    const pixels = points.map(([x, y]) => { const offset = (Math.round(y * sy) * size.width + Math.round(x * sx)) * 4; return [bytes[offset + 2], bytes[offset + 1], bytes[offset]] })
    await writeFile(join(output, `${label}.png`), image.toPNG())
    return pixels
  }
  const layers = id => evaluate(`Array.from(document.querySelectorAll('[data-shape-id="${id}"],[data-renderer-background="${id}"]'),e=>({erasing:e.hasAttribute('data-erasing'),opacity:Number(getComputedStyle(e).opacity)}))`)
  try {
    await load('empty'); await key('E'); await mouse('mouseDown', 200, 440); await mouse('mouseMove', 320, 440)
    check((await state()).eraser.points.length > 0, '拖动没有灰色尾迹')
    const [head, background] = await capture('tail-white', [[320, 440], [340, 440]])
    equal(background, [255, 255, 255], '尾迹对照背景必须纯白')
    check(Array.isArray(expected?.head) && expected.head.length === 3 && expected.head.every(Number.isFinite), '缺少独立旧版白底头部样本')
    check(head.every((v, i) => Math.abs(v - expected.head[i]) <= 3), `尾迹合成像素不符: ${JSON.stringify({ legacy: expected.head, native: head })}`)
    samples.push({ label: 'tail-composite', legacy: expected.head, native: head, difference: head.map((v, i) => Math.abs(v - expected.head[i])) })
    await mouse('mouseUp', 320, 440); await until(s => s.eraser === null && !s.needsFrame)

    if (colorOnly) return { tailComposite: { legacy: expected.head, native: head }, assertions }
    await load()
    await key('E'); check((await state()).toolId === 'eraser', '原生E没有进入橡皮')
    const before = await capture('multi-before', [[290, 260]])
    await mouse('mouseDown', 240, 260)
    const pointing = await remember('multi-pointing')
    equal(pointing.erasingIds, ['shape:back', 'shape:front'], '普通点按未淡化所有重叠层')
    check(pointing.eraserRecords.length === 5 && pointing.commitCalls === 0 && pointing.revision === '0', '按下已经改文档或提交')
    check((await layers('shape:front')).every(l => l.erasing && Math.abs(l.opacity - 82 / 255) < .00001), '叶对象没有按令牌alpha淡化')
    const dim = await capture('multi-held', [[290, 260]])
    check(dim[0].every((v, i) => Math.abs(v - (before[0][i] * (82 / 255) + 255 * (173 / 255))) <= 3), `淡化合成像素不符: ${JSON.stringify({ before, dim })}`)
    await mouse('mouseUp', 240, 260); await until(s => s.commitCalls === 1 && !s.submitting)
    check((await state()).eraserRecords.length === 3, '松手没有整批删除')
    await key('Z', ['meta']); await until(s => s.eraserRecords.length === 5 && !s.submitting)
    check((await layers('shape:front')).every(l => !l.erasing && l.opacity === 1), '松手后撤销恢复仍残留淡化')
    await key('Z', ['meta', 'shift']); await until(s => s.eraserRecords.length === 3 && !s.submitting)
    await remember('multi-undo-redo')

    await load('half'); await key('E')
    const halfBefore = await capture('half-before', [[290, 260]])
    await mouse('mouseDown', 290, 260)
    check((await layers('shape:front')).every(l => l.erasing && Math.abs(l.opacity - .5 * 82 / 255) < .00001), '半透明原值没有乘令牌alpha')
    check((await state()).eraserRecords.find(r => r.id === 'shape:front').opacity === .5, '预览改写原记录opacity')
    const halfDim = await capture('half-held', [[290, 260]])
    samples.push({ label: 'half-composite', before: halfBefore, held: halfDim })
    check(halfDim[0].every((v, i) => Math.abs(v - (halfBefore[0][i] * 82 / 255 + 173)) <= 3), `半透明淡化像素不符: ${JSON.stringify({ halfBefore, halfDim })}`)
    await key('Escape'); await mouse('mouseUp', 290, 260)
    check((await layers('shape:front')).every(l => !l.erasing && l.opacity === .5), '取消没有恢复原0.5透明度')
    equal((await capture('half-cancelled', [[290, 260]]))[0], halfBefore[0], '取消后的合成像素没有恢复')
    await click(290, 260); await key('Z', ['meta']); await until(s => s.eraserRecords.length === 5 && !s.submitting)
    check((await layers('shape:front')).every(l => !l.erasing && l.opacity === .5), '松手删除后撤销没有恢复原0.5透明度')
    await remember('half-opacity-restored')

    await load(); await key('E'); await mouse('mouseDown', 240, 260, ['meta'])
    equal((await state()).erasingIds, ['shape:front'], 'Meta点按必须只有顶层')
    await mouse('mouseMove', 244, 260, ['meta']); check((await state()).mode === 'pointing', '4屏幕px不应开始拖擦')
    const reads = (await state()).snapshotReads
    await mouse('mouseMove', 245, 260, ['meta']); equal((await state()).erasingIds, ['shape:back', 'shape:front'], '5px拖动未恢复多层')
    await mouse('mouseMove', 620, 260, ['meta'])
    const dragged = await remember('meta-drag'); equal(dragged.erasingIds, ['shape:back', 'shape:far', 'shape:front'], '跨段没有累积中间对象')
    check(dragged.snapshotReads === reads && dragged.commitCalls === 0, '移动序列化全板或提前提交')
    await key('Escape'); await mouse('mouseUp', 620, 260); check((await state()).eraserRecords.length === 5 && (await state()).commitCalls === 0, 'Esc留下迟到删除/历史')
    check((await state()).toolId === 'eraser', 'Esc取消错误退出橡皮')
    await mouse('mouseDown', 240, 260); await key('V'); await mouse('mouseUp', 240, 260)
    check((await state()).toolId === 'select' && (await state()).commitCalls === 0, 'V切工具没有取消待擦除')
    await key('E'); await click(840, 260); const transparent = await remember('transparent-locked')
    check(ids(transparent).includes('shape:locked') && !ids(transparent).includes('shape:transparent'), '透明对象/锁定对象语义不符')

    await load('group'); await key('E'); await mouse('mouseDown', 220, 260)
    equal((await state()).erasingIds, [], '直接点中锁住的子对象应跳过'); await key('Escape'); await mouse('mouseUp', 220, 260)
    const groupBefore = await capture('group-before', [[220, 260], [260, 420]])
    await mouse('mouseDown', 440, 260); equal((await state()).erasingIds, ['shape:group'], '未锁子对象没有提升到组')
    const groupLayers = await layers('shape:group'); check(groupLayers.length === 2 && groupLayers.every(l => l.erasing), '普通树和荧光背景树未一起淡化')
    check((await layers('shape:highlight')).every(l => !l.erasing), '后代重复应用淡化')
    const groupDim = await capture('group-held', [[220, 260], [260, 420]])
    const mask = 82 / 255, highlightAlpha = 1 - (1 - .82 * mask) * (1 - .35 * mask)
    const groupExpected = [groupBefore[0].map(v => v * mask + 255 * (1 - mask)), [253, 221, 0].map(v => v * highlightAlpha + 255 * (1 - highlightAlpha))]
    samples.push({ label: 'group-composite', before: groupBefore, held: groupDim, expected: groupExpected })
    check(groupDim.every((rgb, p) => rgb.every((v, i) => Math.abs(v - groupExpected[p][i]) <= 3)), `组/荧光淡化像素不符: ${JSON.stringify({ groupBefore, groupDim, groupExpected })}`)
    await key('Escape'); await mouse('mouseUp', 440, 260)
    check((await layers('shape:group')).every(l => !l.erasing && l.opacity === 1), '取消后组/荧光残留淡化')
    // Changing a compositing layer can round the two highlight passes by one
    // byte. DOM opacity above must restore exactly; pixel alpha must agree too.
    const groupRestored = await capture('group-cancelled', [[220, 260], [260, 420]])
    check(groupRestored.every((rgb, p) => rgb.every((v, i) => Math.abs(v - groupBefore[p][i]) <= 1)), `取消后组/荧光像素没有恢复: ${JSON.stringify({ groupBefore, groupRestored })}`)
    samples.push({ label: 'group-restored', pixels: groupRestored })
    await mouse('mouseDown', 440, 260)
    await mouse('mouseUp', 440, 260); await until(s => s.eraserRecords.length === 0 && !s.submitting)
    await key('Z', ['meta']); await until(s => s.eraserRecords.length === 4 && !s.submitting); await remember('group-cascade-undo')

    await load('frame'); await key('E')
    for (const [x, y, wanted] of [[780, 330, []], [880, 330, []], [840, 330, ['shape:clipped']], [700, 270, ['shape:child']], [650, 330, ['shape:frame']]]) {
      await mouse('mouseDown', x, y); equal((await state()).erasingIds, wanted, `画框可见命中${x},${y}`); await key('Escape'); await mouse('mouseUp', x, y)
    }
    await remember('frame-clipping')
    await load('geometry'); await key('E')
    for (const [x, y, wanted] of [[200, 300, []], [100, 300, ['shape:hollow']], [750, 300, ['shape:arrow']], [750, 312, []]]) {
      await mouse('mouseDown', x, y); equal((await state()).erasingIds, wanted, '真实轮廓'); await key('Escape'); await mouse('mouseUp', x, y)
    }
    for (const z of [.5, 1, 2]) {
      await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:${z}});void 0`); await flush()
      await mouse('mouseDown', 340 * z, 320 * z); await mouse('mouseMove', 410 * z, 320 * z)
      check((await state()).erasingIds.includes('shape:small'), '稀疏整段或视角换算漏掉小对象'); await key('Escape'); await mouse('mouseUp', 410 * z, 320 * z)
    }
    await remember('geometry-zoom')

    await load('empty'); await key('D'); await mouse('mouseDown', 100, 220); await mouse('mouseMove', 300, 220); await mouse('mouseUp', 300, 220)
    await until(s => s.eraserRecords.length === 1 && !s.submitting); await key('E'); await click(200, 220)
    check((await state()).eraserRecords.length === 0, '原生笔画不能擦除'); await remember('native-draw-erased')

    await load('empty'); await evaluate("const input=document.createElement('input');input.id='eraser-input';document.body.append(input);input.focus();void 0")
    await key('E'); check((await state()).toolId === 'select' && (await state()).inputContext.owner === 'form', '表单输入E偷走工具')
    await load('empty', '&shortcuts=0'); await key('E'); check((await state()).toolId === 'select', '关闭快捷键后E仍切换')
    await load('empty', '&limited=1'); await key('E'); check((await state()).toolId === 'select', '未开放工具仍可用E进入')
    await remember('keyboard-gates')
    await writeFile(join(output, 'eraser-samples.json'), JSON.stringify(samples, null, 2))
    return { assertions, samples: samples.length, overlapPointAndMetaDrag: true, cancelAndToolSwitch: true, lockTransparencyGroups: true, foregroundAndHighlightComposite: true, frameClipGeometryZoom: true, nativeStrokeDelete: true, tailComposite: { legacy: expected.head, native: head }, keyboardGates: true }
  } catch (error) {
    await writeFile(join(output, 'eraser-failure.json'), JSON.stringify({ error: error.stack, state: await state(), samples }, null, 2))
    throw error
  }
}
