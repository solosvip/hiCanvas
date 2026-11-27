import { renderCanvasExport, preflightCanvasExport, loadGeneratedFrame } from '../../renderer/index.js'
import { exportWebHtml, createExternalExportFixture } from './export-fixture.js'
import { getContentChannel } from '../../content-channel/index.js'

const insist = (condition, message) => { if (!condition) throw new Error(message) }
async function pixels(result, doc, points) {
  const bitmap = await createImageBitmap(new Blob([result.bytes], { type: result.mime })), canvas = doc.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
    return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
  } finally { bitmap.close(); canvas.width = canvas.height = 0 }
}
async function countPixels(result, doc, regions, colour) {
  const bitmap = await createImageBitmap(new Blob([result.bytes], { type: result.mime })), canvas = doc.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
    return regions.map(region => {
      const [x, y, w, height] = region.map(value => Math.round(value * result.scale))
      const { data } = context.getImageData(x, y, w, height)
      let count = 0
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200 && (colour ? colour.every((value, channel) => Math.abs(data[i + channel] - value) <= 3) : data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100)) count++
      return count
    })
  } finally { bitmap.close(); canvas.width = canvas.height = 0 }
}

export function installExportProbe({ host, session, interaction, transport, output }) {
  const doc = host.ownerDocument
  const mediaReady = () => session.store.allRecords().filter(record => record.typeName === 'shape' && record.type === 'embed').every(shape => {
    const iframe = [...host.querySelectorAll('iframe[data-embed-content]')].find(node => node.dataset.embedContent === shape.id)
    return iframe && !!getContentChannel(iframe)
  })
  let results = []
  async function verify(kind) {
    if (kind === 'media') {
      const video = host.querySelector('[data-shape-id="shape:export-video"] video'), end = Date.now() + 10000
      while (video && (video.readyState < 2 || video.seeking)) {
        insist(Date.now() < end, '合成视频初始帧尚未就绪')
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    const snapshot = session.store.getStoreSnapshot('document'), before = JSON.stringify(snapshot), state = JSON.stringify(interaction.state.get()), commits = transport.getCommitCount()
    const render = options => renderCanvasExport(snapshot, { document: doc, host, format: 'png', ...options })
    results = []
    if (kind === 'static') {
      const all = await render({ format: 'svg' })
      insist(JSON.stringify(all.bounds) === JSON.stringify({ x: 198, y: 238, w: 624, h: 274 }), '整页范围不符')
      const single = await render({ ids: ['shape:export-left'] })
      insist(single.width === 408 && single.height === 208, '默认两倍尺寸不符')
      const sampled = await pixels(single, doc, [[0, 0], [204, 104]])
      insist(sampled[0][3] === 0 && sampled[1].join() === '220,225,248,255', '透明底或几何实际像素不符')
      const larger = await render({ ids: ['shape:export-left'], scale: 1, bounds: { x: 190, y: 230, w: 220, h: 120 }, background: '#ffffff' })
      const corner = await pixels(larger, doc, [[0, 0]])
      insist(corner[0].join() === '255,255,255,255', '背景像素不符')
      results.push({ case: kind, bounds: all.bounds, width: single.width, height: single.height, sampled, corner })
      let denied = false
      try { preflightCanvasExport(snapshot, { bounds: { x: 0, y: 0, w: 100000, h: 100000 } }) } catch { denied = true }
      insist(denied, '巨图未在分配前拒绝')
    } else if (kind === 'text') {
      const svg = await render({ format: 'svg' }), xml = new TextDecoder().decode(svg.bytes)
      insist(xml.includes('Synthetic') && !xml.includes('Longname') && !xml.includes('foreignObject') && xml.includes('data:font/woff2'), '共享文字/署名/字体不符')
      const png = await render({})
      insist(png.bytes.length > 2000, '文字PNG疑似空白')
      const transparent = await pixels(png, doc, [[(920 - png.bounds.x) * png.scale, (620 - png.bounds.y) * png.scale]])
      insist(transparent[0][3] === 0 && png.bounds.x + png.bounds.w >= 940, '全透明对象未保留范围或输出了不透明像素')
      const clipped = await render({ format: 'svg', ids: ['shape:export-child'] })
      insist(new TextDecoder().decode(clipped.bytes).includes('clip-path'), '父框裁剪缺失')
      results.push({ case: kind, bytes: png.bytes.length, clippedBounds: clipped.bounds, fontsEmbedded: true, foreignObject: false, transparent })
    } else if (kind === 'decorations') {
      const rendered = await render({ ids: ['shape:export-under-title', 'shape:export-wide-frame'] })
      const point = [(450 - rendered.bounds.x) * rendered.scale, (188 - rendered.bounds.y) * rendered.scale]
      const sampled = await pixels(rendered, doc, [point])
      insist(sampled[0].join() === '244,218,219,255', '短标题底板遮住了下层对象')
      const card = await render({ ids: ['shape:export-card'] })
      const element = host.querySelector('[data-bookmark="shape:export-card"]'), box = element.getBoundingClientRect(), regions = []
      for (const [selector, lineHeight, lines] of [['[data-bookmark-title]', 25.6, 2], ['[data-bookmark-description]', 18, 3]]) {
        const rect = element.querySelector(selector).getBoundingClientRect()
        insist(rect.height > lineHeight * (lines - 1), '书签夹具未实际换行')
        for (let i = 0; i < lines; i++) regions.push([rect.x - box.x, rect.y - box.y + i * lineHeight, rect.width, lineHeight])
      }
      const ink = await countPixels(card, doc, regions)
      insist(ink.every(count => count > 30), `书签可见文字行丢失：${ink}`)
      results.push({ case: 'decorations', sampled, cardBytes: card.bytes.length, ink })
    } else if (kind === 'external') {
      const candidate = createExternalExportFixture(), fixed = JSON.stringify(candidate)
      const image = await renderCanvasExport(candidate, { document: doc, host: null, format: 'png', ids: ['shape:external-image'] })
      const card = await renderCanvasExport(candidate, { document: doc, host: null, format: 'png', ids: ['shape:external-card'] })
      for (const [result, expected] of [[image, 1], [card, 2]]) {
        insist(result.status === 'complete' && result.blockedResources === expected && result.failedResources === 0, '外链素材没有明确替换')
        insist(result.warnings.length === 1 && /占位/.test(result.warnings[0]), '外链素材缺少一条汇总提示')
      }
      const placeholder = await countPixels(image, doc, [[0, 0, 160, 160]], [159, 168, 178])
      const icon = await countPixels(card, doc, [[12, 288, 18, 22]], [159, 168, 178])
      insist(placeholder[0] > 100 && icon[0] > 10, '外链图片或书签图标没有实际占位像素')
      insist(fixed === JSON.stringify(candidate), '外链占位改写了快照')
      results.push({ case: 'external', placeholder, icon, warnings: [image.warnings, card.warnings], blockedResources: [image.blockedResources, card.blockedResources] })
    } else if (kind === 'network') {
      for (const mounted of [true, false]) {
        const rendered = await render({ ids: ['shape:export-network'], ...(!mounted && { host: null }) })
        const sampled = await pixels(rendered, doc, [[220, 220]])
        insist(sampled[0].join() === '32,239,96,255', `内容网络夹具${mounted ? '当前' : '初始'}画面缺少替身像素`)
        results.push({ case: 'content-network', mounted, sampled })
      }
    } else if (kind === 'animation') {
      const entrance = await render({ ids: ['shape:export-entrance'] })
      const final = await pixels(entrance, doc, [[200, 200]])
      const iframe = host.querySelector('iframe[data-embed-content="shape:export-film"]'), channel = getContentChannel(iframe)
      insist(channel, '影片通道未挂载')
      let status
      const unsubscribe = channel.subscribe(value => { status = value })
      try {
        await channel.request('pause'); await channel.request('seek', .75)
        const end = Date.now() + 5000
        while (!status?.ready || status.playing || Math.abs(status.currentTime - .75) > 1 / 30) {
          insist(Date.now() < end, `测试暂停位置尚未就绪：${JSON.stringify(status)}`)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        const beforePlayback = JSON.stringify(status)
        const frame = await render({ ids: ['shape:export-film'] })
        const moving = await pixels(frame, doc, [[160, 160], [20, 160]])
        const failures = []
        if (final[0].join() !== '32,239,96,255') failures.push(`入场动画最终状态未输出：${JSON.stringify(final)}`)
        if (moving[0].join() !== '32,239,96,255' || moving[1].join() !== '185,32,48,255') failures.push(`WAAPI非零暂停帧回到初始位置：${JSON.stringify(moving)}`)
        insist(!failures.length, failures.join('；'))
        insist(JSON.stringify(status) === beforePlayback, `输出改变影片当前时刻或播放状态：${beforePlayback} → ${JSON.stringify(status)}`)
        const initial = await render({ ids: ['shape:export-film'], host: null })
        const initialPixels = await pixels(initial, doc, [[160, 160], [20, 160]])
        insist(initialPixels[0].join() === '185,32,48,255' && initialPixels[1].join() === '32,239,96,255', `未挂载影片未取第0帧：${JSON.stringify(initialPixels)}`)
        insist(JSON.stringify(status) === beforePlayback, '临时初始影片改变了已挂载影片状态')
        results.push({ case: 'animation', final, moving, initialPixels, playback: status })
      } finally { unsubscribe() }
    } else if (kind === 'media') {
      for (const id of ['web', 'film', 'slide', 'video', 'image']) {
        const video = id === 'video' ? host.querySelector('[data-shape-id="shape:export-video"] video') : null
        const playback = video && { time: video.currentTime, paused: video.paused }
        let expectedVideo
        if (video) {
          const canvas = doc.createElement('canvas'); canvas.width = 320; canvas.height = 180
          try {
            const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 320, 180)
            expectedVideo = [[10, 50], [310, 170]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
          } finally { canvas.width = canvas.height = 0 }
        }
        const rendered = await render({ ids: [`shape:export-${id}`] })
        const sampled = await pixels(rendered, doc, [[20, 100], [rendered.width - 20, rendered.height - 20], [160, 100]])
        if (id === 'web' || id === 'slide') insist(sampled[0].join() === '28,72,112,255' && sampled[1].join() === '239,56,0,255', '网页/幻灯片是占位或错误画面')
        if (id === 'film') insist(sampled[1].join() === '185,32,48,255', '影片画面未输出')
        if (id === 'image') insist(sampled[2].join() === '255,0,0,255', '非对称裁剪与翻转顺序不符')
        if (video) {
          insist(sampled.slice(0, 2).every((rgba, i) => rgba.every((value, channel) => Math.abs(value - expectedVideo[i][channel]) <= 2)), '视频输出不是当前已解码的实际像素')
          insist(video.currentTime === playback.time && video.paused === playback.paused, '输出改变了视频播放位置或状态')
        }
        const initial = await render({ ids: [`shape:export-${id}`], host: null, format: 'svg' })
        const xml = new TextDecoder().decode(initial.bytes)
        insist(xml.includes('data:image/png') && !/iframe|<script|\.localhost:/i.test(xml), '媒体未内联或泄漏实例能力')
        let initialPixels, expectedInitialVideo
        if (video) {
          // The committed four-quadrant MP4 starts red/yellow at these points;
          // its .5s mounted frame is cyan/lavender. Independent first-frame
          // decoding gives RGB 254/0/0 and 254/254/0 (allow codec rounding).
          expectedInitialVideo = [[254, 0, 0, 255], [254, 254, 0, 255]]
          const initialPng = await render({ ids: ['shape:export-video'], host: null })
          initialPixels = await pixels(initialPng, doc, [[20, 100], [initialPng.width - 20, initialPng.height - 20]])
          insist(initialPixels.every((rgba, i) => rgba.every((value, channel) => Math.abs(value - expectedInitialVideo[i][channel]) <= 4)), `未挂载视频不是第0帧：${JSON.stringify({ initialPixels, expectedInitialVideo })}`)
          insist(video.currentTime === playback.time && video.paused === playback.paused, '初始视频输出改变了已挂载视频状态')
        }
        results.push({ case: id, width: rendered.width, height: rendered.height, sampled, playback, expectedVideo, initialPixels, expectedInitialVideo, initialBytes: initial.bytes.length })
      }
      for (const failure of ['dispose', 'cancel', 'timeout']) {
        const frame = await loadGeneratedFrame(exportWebHtml), container = doc.createElement('div'), iframe = doc.createElement('iframe')
        container.dataset.shapeId = 'shape:export-web'; iframe.dataset.embedContent = 'shape:export-web'
        iframe.width = '320'; iframe.height = '200'
        for (const [key, value] of Object.entries(frame.attributes)) iframe.setAttribute(key, value)
        const loaded = new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }))
        container.append(iframe); doc.body.append(container)
        const controller = new AbortController()
        let timer
        try {
          await loaded; frame.bind(iframe)
          await render({ ids: ['shape:export-web'], host: container, format: 'svg' })
          await new Promise(resolve => setTimeout(resolve, 100))
          const task = render({ ids: ['shape:export-web'], host: container, signal: controller.signal, timeout: failure === 'timeout' ? 30 : 30000 })
          if (failure !== 'timeout') timer = setTimeout(() => { if (failure === 'dispose') { void frame.dispose(); container.remove() } else controller.abort(new Error('Synthetic capture cancellation')) }, 30)
          let error
          try { await task } catch (value) { error = value }
          insist(error && /失效|取消|更换|cancellation|期限/.test(error.message), `媒体${failure}没有明确失败`)
          results.push({ case: failure, message: error.message, blockedResources: error.blockedResources, failedResources: error.failedResources })
        } finally { clearTimeout(timer); controller.abort(); container.remove(); await frame.dispose() }
      }
    } else if (kind === 'empty') insist((await render({})).status === 'empty', '空画板没有返回空结果')
    else throw new Error('未知输出检查。')
    insist(before === JSON.stringify(session.store.getStoreSnapshot('document')), '输出改写文档')
    insist(state === JSON.stringify(interaction.state.get()) && commits === transport.getCommitCount(), '输出改变了编辑状态或提交事务')
    return structuredClone(results)
  }
  const api = Object.freeze({ inspect: () => ({ ...output.inspect(), results: structuredClone(results), shapeCount: session.store.allRecords().filter(r => r.typeName === 'shape').length, commitCalls: transport.getCommitCount() }), verify, mediaReady })
  Object.defineProperty(globalThis, '__HICANVAS_EXPORT_PROBE__', { value: api, configurable: true })
  return () => { delete globalThis.__HICANVAS_EXPORT_PROBE__ }
}
