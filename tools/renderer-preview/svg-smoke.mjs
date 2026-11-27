import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { svgDimensions, svgAttacks } from './svg-fixtures.js'

const check = (value, message) => { if (!value) throw new Error(message) }
export async function svgSecuritySmoke(createWindow, origin, config, output) {
  const audit = { blocked: [], errors: [], executions: [], requests: [] }, window = createWindow('svg-security', audit)
  const board = await (await fetch(origin + '/__renderer_fixture?gallery=image-import')).json()
  const api = async args => {
    const response = await fetch(`${origin}/api/canvas/reference?conversation=${board.conversationId}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: JSON.stringify(args) })
    return { status: response.status, body: await response.json() }
  }
  const results = []
  try {
    // Same direct-resource response and identical sandbox/Node/network boundary
    // as the clean cases. The detector must observe the deliberately raw probe.
    audit.expectedDocument = config.positive
    await window.loadURL(config.positive); await delay(150)
    check(audit.executions.length > 0 && audit.requests.length > 0, '原始SVG阳性对照没有触发脚本与尝试请求，检测器无效')
    check(audit.requests.some(url => url.includes('svg-positive-pixel.png')), '同源子资源尝试没有被网络探针计数')
    const positive = structuredClone(audit)
    for (const list of Object.values(audit)) if (Array.isArray(list)) list.length = 0
    for (const attack of svgAttacks) {
      const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(attack.source).toString('base64')
      const prepared = await api({ purpose: 'file-import-prepare', dataUrl })
      if (attack.reject) {
        check(prepared.status === 400, `恶意SVG没有明确拒绝：${attack.name}`)
        results.push({ name: attack.name, rejected: true }); continue
      }
      check(prepared.status === 200, `SVG准备失败：${attack.name} ${JSON.stringify(prepared)}`)
      const saved = await api({ purpose: 'file-import', dataUrl, sanitized: true })
      check(saved.status === 200, `SVG最终再净化失败：${attack.name}`)
      const response = await fetch(origin + saved.body.src)
      check(response.headers.get('x-content-type-options') === 'nosniff' && response.headers.get('content-security-policy')?.includes('sandbox') && !response.headers.get('content-security-policy').includes('allow-same-origin'), 'SVG直接响应隔离退化')
      audit.expectedDocument = origin + saved.body.src
      await window.loadURL(audit.expectedDocument); await delay(80)
      check(!audit.requests.length && !audit.executions.length && !audit.errors.length, `净化SVG产生脚本、尝试请求或错误：${attack.name} ${JSON.stringify(audit)}`)
      results.push({ name: attack.name, requests: 0, executions: 0, errors: 0 })
    }
    const result = { positive, clean: results, audit }
    await writeFile(join(output, 'svg-security.json'), JSON.stringify(result, null, 2))
    return result
  } finally { window.destroy() }
}

export async function svgImportSmoke(window, output, files) {
  const wc = window.webContents, debug = wc.debugger, evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const shapes = value => value.imageRecords.filter(record => record.typeName === 'shape')
  const until = async (predicate, message) => {
    const end = Date.now() + 15000
    while (Date.now() < end) { const value = await predicate(); if (value && !(await state()).submitting) return value; await delay(30) }
    throw new Error(`SVG原生检查超时：${message}`)
  }
  const key = async (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers }); await delay(60) }
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  const drop = async paths => { for (const type of ['dragEnter', 'dragOver', 'drop']) await debug.sendCommand('Input.dispatchDragEvent', { type, x: 550, y: 420, data: { items: [], files: paths, dragOperationsMask: 1 } }) }
  const reset = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0')
  const loaded = id => until(() => evaluate(`(() => {const n=document.querySelector('[data-shape-id="${id}"] img');return n?.complete&&n.naturalWidth>0})()`), '真实SVG解码')
  const insert = async paths => {
    const before = shapes(await state()), ids = new Set(before.map(shape => shape.id))
    await drop(paths); await until(async () => shapes(await state()).length === before.length + paths.length, '原生文件拖入')
    return shapes(await state()).filter(shape => !ids.has(shape.id))
  }
  const stages = [], dimensions = []
  await reset()
  const [positive] = await insert([files.svg]); await loaded(positive.id)
  const box = await evaluate(`(() => {const b=document.querySelector('[data-shape-id="${positive.id}"] img').getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}})()`)
  const pixel = async (x, y) => {
    const b = (await wc.capturePage({ x: Math.floor(box.x + (x + .5) * box.w / 320), y: Math.floor(box.y + (y + .5) * box.h / 180), width: 1, height: 1 })).toBitmap()
    return [b[2], b[1], b[0]]
  }
  const green = await pixel(25, 25), gradient = await pixel(160, 50), arrow = await pixel(240, 104)
  check(green[1] > 240 && green[0] < 10 && green[2] < 10, `SVG use图块无绿色像素：${green}`)
  check(gradient[0] > 80 && gradient[0] < 180 && gradient[2] > 80 && gradient[2] < 180, `SVG类样式渐变不符：${gradient}`)
  check(arrow[2] > 240 && arrow[0] < 10 && arrow[1] < 10, `SVG marker箭头三角形未绘制：${arrow}`)
  await writeFile(join(output, 'svg-renderer-pixels.png'), (await wc.capturePage()).toPNG())
  for (const sample of svgDimensions) {
    const [shape] = await insert([files['svg-' + sample.name]])
    check(shape.props.w === sample.w && shape.props.h === sample.h, `SVG ${sample.name}自然尺寸不符：${shape.props.w}×${shape.props.h}`)
    dimensions.push({ name: sample.name, w: shape.props.w, h: shape.props.h })
  }
  const [features] = await insert([files['svg-features']]); await loaded(features.id)
  const featurePixels = await evaluate(`(() => {
    const image=document.querySelector('[data-shape-id="${features.id}"] img'),canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);return [[20,20],[60,20],[100,20],[140,20],[40,120],[100,100]].map(([x,y])=>[...context.getImageData(x,y,1,1).data])
  })()`)
  check(featurePixels[0][0] === 255 && featurePixels[1][3] === 0, `SVG clipPath没有裁掉右半：${JSON.stringify(featurePixels)}`)
  check(featurePixels[2][1] === 255 && featurePixels[3][3] === 0, 'SVG mask没有遮掉右半')
  check(featurePixels[4][0] > 240 && featurePixels[4][1] > 240 && featurePixels[4][2] < 20, 'SVG径向渐变中心不是黄色')
  check(featurePixels[5][0] > 240 && featurePixels[5][1] < 10, 'SVG内嵌栅格没有解码红色')
  await reset()
  const before = shapes(await state()).length, commitBefore = await evaluate('window.__imageCommits')
  const entries = await Promise.all([files.svg, files.png, files.webm].map(async path => ({ base64: (await readFile(path)).toString('base64'), name: path.split('/').at(-1), mime: path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.webm') ? 'video/webm' : 'image/png' })))
  check(await evaluate(`(() => {const dt=new DataTransfer();for(const file of ${JSON.stringify(entries)})dt.items.add(new File([Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0))],file.name,{type:file.mime}));dt.setData('text/html','<p>不要重复创建</p>');const host=document.querySelector('#canvas');host.focus();const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});host.dispatchEvent(e);return e.defaultPrevented})()`), 'SVG混合文件粘贴没有接入公共宿主')
  await until(async () => shapes(await state()).length === before + 3, 'SVG/PNG/WebM混合粘贴')
  check(await evaluate('window.__imageCommits') === commitBefore + 1, 'SVG混合批次不是一次提交')
  await key('z', [mod]); await until(async () => shapes(await state()).length === before, 'SVG混合批次一次撤销')
  await key('z', [mod, 'shift']); await until(async () => shapes(await state()).length === before + 3, 'SVG混合批次一次重做')
  const failedCount = shapes(await state()).length
  await drop([files.png, files['svg-bad-xml']])
  await until(() => evaluate("document.querySelector('#status').textContent.includes('SVG')"), '坏SVG反馈')
  check(shapes(await state()).length === failedCount, '坏SVG第二项留下半批')
  const audit = await evaluate('({clipboard:window.__imageClipboardViolations,uncaught:window.__imageUncaught})')
  check(!audit.clipboard.length && !audit.uncaught.length, `SVG原生留下错误或调用真实剪贴板：${JSON.stringify(audit)}`)
  stages.push({ positive: { green, gradient, arrow }, dimensions, featurePixels, mixedBatchUndoRedo: true, corruptBatch: true, audit })
  await writeFile(join(output, 'svg-native.json'), JSON.stringify(stages, null, 2))
  return stages[0]
}
