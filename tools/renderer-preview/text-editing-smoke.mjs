import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { getShapeTextLayout, createConnectionContext } from '../../renderer/geometry.js'

// Native input only. DOM geometry/selection and the synthetic preview's
// public read-only state observe the result; no editor/Store mutation via JS.
export async function textEditingSmoke(target, output) {
  const contents = target.webContents, samples = []
  const evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const check = (value, message) => { if (!value) throw new Error(message) }
  const shape = (value, id) => value.textShapes.find(shape => shape.id === id)
  const text = node => node?.text || (node?.content || []).map(text).join('\n')
  const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  async function until(predicate, label) {
    const end = Date.now() + 10000
    while (Date.now() < end) { const value = await state(); if (value.error) throw new Error(value.error); if (predicate(value)) return value; await delay(20) }
    throw new Error(`文字回归等待超时：${label}；${JSON.stringify(await state())}`)
  }
  const key = async (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({ type, keyCode: keyCode.replace(/^Arrow/, ''), modifiers }); await flush() }
  const mouse = async (type, x, y, modifiers = []) => { contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown', ...modifiers] : modifiers }); await flush() }
  const click = async (x, y, modifiers) => { await mouse('mouseDown', x, y, modifiers); await mouse('mouseUp', x, y, modifiers) }
  const double = async (x, y, modifiers) => { await click(x, y, modifiers); await click(x, y, modifiers) }
  const insert = async value => { contents.insertText(value); await flush() }
  const box = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r&&{x:r.x,y:r.y,w:r.width,h:r.height}})()`)
  async function load(gallery = 'text-editing', extra = '') {
    const url = new URL(contents.getURL()); url.search = `?gallery=${gallery}&edgeScrolling=0${extra}`
    await target.loadURL(url.href); await until(s => s.ready, '就绪')
    await evaluate("document.querySelector('#canvas').focus();void 0")
  }
  const remember = async label => {
    const value = await state(), context = createConnectionContext(value.textShapes)
    for (const record of value.textShapes.filter(shape => shape.type !== 'frame')) check(JSON.stringify(getShapeTextLayout(record, context)) === JSON.stringify(value.textLayouts[record.id]), `Node与浏览器文字几何不同：${record.id}`)
    samples.push({ label, ...value }); return value
  }
  const choose = async (field, value) => {
    const selector = `[data-text-style="${field}"]`
    for (let i = 0; i < 4; i++) {
      if (await evaluate(`document.querySelector(${JSON.stringify(selector)}).dataset.value`) === value) return
      const button = await box(selector); await click(button.x + button.w / 2, button.y + button.h / 2)
    }
    check(await evaluate(`document.querySelector(${JSON.stringify(selector)}).dataset.value`) === value, `原生点击未改变样式：${field}/${value}`)
  }
  contents.debugger.attach('1.3')
  const painting = setInterval(() => contents.invalidate(), 30)
  try {
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await load()
    await double(130, 212); await until(s => s.textEditing?.id === 'shape:text', '普通文字')
    check(await evaluate('window.getSelection().toString()') === 'Alpha Beta', '进入文字没有全选原文')
    await insert('one'); await delay(1100); await insert('two'); await delay(1100); await insert('three')
    check(text(shape(await state(), 'shape:text').props.richText) === 'onetwothree', '逐次预览重建了编辑器或丢了插入点')
    await key('Z', ['meta'])
    check((await state()).textEditing && (await state()).revision === '0', '编辑内撤销误发画板历史')
    await key('Z', ['meta', 'shift']); await key('Escape')
    await until(s => !s.textEditing && s.revision === '1', 'Esc保存')
    check(text(shape(await state(), 'shape:text').props.richText) === 'onetwothree', '保存文字不完整')
    await key('Z', ['meta']); await until(s => s.revision === '2', '整次撤销')
    check(text(shape(await state(), 'shape:text').props.richText) === 'Alpha Beta', '整次撤销没有恢复原文')
    await key('Z', ['meta', 'shift']); await until(s => s.revision === '3', '整次重做')
    await remember('plain-selection-and-history')

    await load('text-editing', '&slowTextSave=1')
    await double(130, 212); await until(s => s.textEditing, '延迟保存进入')
    await insert('draft before save'); await key('Escape')
    await until(s => s.textEditing?.isSaving, '提交等待只读状态')
    check(await evaluate("document.querySelector('.tiptap').getAttribute('contenteditable')") === 'false', '保存等待期间仍接受文字输入')
    await key('X'); await until(s => !s.textEditing && s.revision === '1', '延迟保存完成')
    check(text(shape(await state(), 'shape:text').props.richText) === 'draft before save', '只读保存阶段改变了草稿')
    await remember('saving-readonly')

    await load()

    await double(625, 275); await until(s => s.textEditing?.id === 'shape:geo', '几何标签')
    await insert('Native geo label'); await key('Enter', ['meta'])
    await until(s => !s.textEditing && s.revision === '1', '标签完成键')
    check(await evaluate("document.querySelector('[data-geo-label]').textContent") === 'Native geo label', '几何标签退出后没有显示')
    await double(300, 500); await until(s => s.textEditing?.id === 'shape:arrow', '箭头标签')
    await insert('Native arrow label'); await key('Escape'); await until(s => !s.textEditing, '箭头保存')
    await double(910, 184); await until(s => s.textEditing?.id === 'shape:frame', '画框标题')
    check(await evaluate("document.activeElement.tagName") === 'INPUT', '标题没有用原生单行input')
    await insert('Native title'); await key('Enter'); await until(s => !s.textEditing, '标题Enter保存')
    check(shape(await state(), 'shape:frame').props.name === 'Native title', '标题没有写name')
    await remember('four-shape-kinds')

    await load(); await double(625, 275); await until(s => s.textEditing?.id === 'shape:geo', '样式编辑进入')
    for (const [size, font] of [['s', 'draw'], ['m', 'sans'], ['l', 'serif'], ['xl', 'mono']]) {
      await choose('size', size); await choose('font', font)
      const current = await state()
      check(shape(current, 'shape:geo').props.size === size && shape(current, 'shape:geo').props.font === font && current.revision === '0', '编辑内样式没有预览或提前提交')
      await remember(`style-${size}-${font}`)
    }
    await choose('horizontal', 'end'); await choose('verticalAlign', 'end')
    await writeFile(join(output, 'geo-editing.png'), (await contents.capturePage()).toPNG())
    const activeBox = await box('[data-canvas-text-editor]'); await click(activeBox.x + 4, activeBox.y + 4); await key('Escape')
    await until(s => !s.textEditing && s.revision === '1', '样式和编辑一次保存')
    const aligned = await state(), geometry = aligned.textLayouts['shape:geo'], painted = await box('[data-geo-label]')
    check(Math.abs(painted.x - (500 + geometry.x)) < .1 && Math.abs(painted.y - (150 + geometry.y)) < .1 && Math.abs(painted.h - geometry.h) < .1, '几何标签显示没有使用统一排版外框')
    await writeFile(join(output, 'geo-saved.png'), (await contents.capturePage()).toPNG())
    await key('Z', ['meta']); await until(s => s.revision === '2', '样式整次撤销')
    check(shape(await state(), 'shape:geo').props.font === 'sans' && shape(await state(), 'shape:geo').props.size === 'm', '样式和编辑未整次撤销')
    await remember('style-alignment-and-undo')

    await load()
    await double(130, 212); await until(s => s.textEditing, '组字进入')
    await contents.debugger.sendCommand('Input.imeSetComposition', { text: 'han', selectionStart: 0, selectionEnd: 3 })
    await key('Enter', ['meta']); check((await state()).textEditing, '组字被完成键退出')
    await contents.debugger.sendCommand('Input.insertText', { text: '汉' }); await flush()
    await key('Escape'); await until(s => !s.textEditing, '组字保存')
    check(text(shape(await state(), 'shape:text').props.richText).includes('汉'), '组字提交丢字')
    await remember('chromium-ime')

    await load()
    await double(130, 212); await until(s => s.textEditing, '表单焦点进入')
    await insert('draft retained')
    await evaluate("(()=>{const n=document.createElement('input');n.id='text-form-probe';n.style.cssText='position:fixed;left:900px;top:120px';document.body.append(n)})();void 0")
    const form = await box('#text-form-probe'); await click(form.x + 5, form.y + 5)
    for (const code of ['R', 'O', 'F', 'G', 'Q', 'A']) await key(code)
    check((await state()).textEditing && (await state()).textShapes.length === 4, '表单焦点丢草稿或误创建')
    const editor = await box('[data-canvas-text-editor]'); await click(editor.x + 4, editor.y + 4); await key('Escape')
    await until(s => !s.textEditing, '表单返回保存')
    check(text(shape(await state(), 'shape:text').props.richText) === 'draft retained', '表单焦点丢字')
    await double(450, 650); await until(s => s.textEditing?.kind === 'text', '空白双击')
    const emptyRevision = (await state()).revision; await key('Escape'); await until(s => !s.textEditing, '空新文字退出')
    check((await state()).revision === emptyRevision && (await state()).textShapes.length === 4, '空新文字留下记录或历史')
    await remember('focus-and-empty-new')

    await key('T'); await mouse('mouseDown', 200, 300); await mouse('mouseMove', 900, 300); await mouse('mouseUp', 900, 300)
    const fixed = await until(s => s.textEditing?.kind === 'text', '拖动创建定宽')
    const fixedId = fixed.textEditing.id
    await insert('A sentence that wraps naturally across a fixed width. '.repeat(8))
    const fixedShape = shape(await state(), fixedId), fixedBox = await box('[data-canvas-text-editor]')
    check(fixedShape.props.w === 700 && !fixedShape.props.autoSize && Math.abs(fixedBox.w - 700) < .1 && fixedBox.h > 50, '拖动未得到700固定宽或没有换行')
    const autoButton = await box('[data-text-auto-size]'); await click(autoButton.x + autoButton.w / 2, autoButton.y + autoButton.h / 2)
    const automatic = await box('[data-canvas-text-editor]')
    check(shape(await state(), fixedId).props.autoSize && automatic.w > 700, '自动大小按钮未恢复随内容增长')
    await click(automatic.x + 4, automatic.y + 4)
    await key('Escape'); await until(s => !s.textEditing, '固定宽保存')
    await key('Z', ['meta']); await until(s => !s.textShapes.some(shape => shape.id === fixedId), '创建和编辑整次撤销')
    await remember('fixed-width-one-transaction')

    await load(); await double(625, 275, ['alt'])
    check(shape(await state(), 'shape:geo').props.geo === 'check-box' && !(await state()).textEditing, 'Alt双击没有独占互换入口')
    await remember('alt-double-click')

    await load('text-formatted')
    const original = shape(await state(), 'shape:formatted').props.richText
    await double(130, 192); await until(s => s.textEditing?.id === 'shape:formatted', '完整schema进入')
    check(await evaluate("Boolean(document.querySelector('.tiptap h2')&&document.querySelector('.tiptap ol')&&document.querySelector('.tiptap ul')&&document.querySelector('.tiptap hr'))"), '完整schema缺少节点')
    await key('Escape'); await until(s => !s.textEditing, '完整schema退出')
    check(JSON.stringify(shape(await state(), 'shape:formatted').props.richText) === JSON.stringify(original) && (await state()).revision === '0', '不改字的进入退出重写了格式或属性')
    await remember('schema-unchanged-roundtrip')
    await double(130, 192); await until(s => s.textEditing, '格式文字再次进入')
    const character = await evaluate("(()=>{const n=document.createTreeWalker(document.querySelector('.tiptap h2'),NodeFilter.SHOW_TEXT).nextNode(),r=document.createRange();r.setStart(n,0);r.setEnd(n,1);const b=r.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()")
    await click(character.x, character.y); await insert('X'); await key('Escape')
    await until(s => !s.textEditing && s.revision === '1', '带格式文字实际修改')
    const edited = shape(await state(), 'shape:formatted').props.richText
    // Compare every original node/mark/attribute recursively; documented
    // extension defaults may be added, but no existing data may disappear.
    const editedHeading = edited.content[0].content[0].text
    check(editedHeading.length === 'Formatted heading'.length + 1 && editedHeading.replace('X', '') === 'Formatted heading', '原生输入没有只修改标题中的一个字')
    const expected = structuredClone(original); expected.content[0].content[0].text = editedHeading
    function retained(expected, actual, path = 'doc') {
      if (Array.isArray(expected)) {
        check(Array.isArray(actual) && expected.length === actual.length, `格式内容长度变化：${path}`)
        if (path.endsWith('.marks')) for (const mark of expected) retained(mark, actual.find(item => item.type === mark.type), `${path}.${mark.type}`)
        else expected.forEach((item, i) => retained(item, actual[i], `${path}[${i}]`))
      } else if (expected && typeof expected === 'object') {
        check(actual && typeof actual === 'object', `格式节点丢失：${path}`)
        for (const [key, value] of Object.entries(expected)) retained(value, actual[key], `${path}.${key}`)
      } else check(expected === actual, `原有格式或属性丢失：${path}`)
    }
    retained(expected, edited)
    await key('Z', ['meta']); await until(s => s.revision === '2', '格式文字整次撤销')
    check(JSON.stringify(shape(await state(), 'shape:formatted').props.richText) === JSON.stringify(original), '格式文字撤销未完整恢复原JSON')
    await remember('schema-edited-roundtrip')
    const lifecycle = await evaluate("import('/tools/renderer-preview/text-lifecycle-probe.js').then(m=>m.textLifecycleProbe())")
    await writeFile(join(output, 'text-editing.json'), JSON.stringify({ samples, lifecycle, nativeInput: true, systemIme: false }, null, 2))
    return { cases: samples.map(sample => sample.label), lifecycle, nativeInput: true, systemIme: false }
  } finally { clearInterval(painting); contents.debugger.detach() }
}
