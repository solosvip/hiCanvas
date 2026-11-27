import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'

export const slideMarkerColors = { 1: [230, 40, 70], 2: [40, 170, 90], 3: [50, 80, 220] }
export function markSlideHtml(html, number) {
  return html.replace('</body>', `<div id="order-marker" style="position:fixed;left:0;top:0;width:64px;height:64px;z-index:9999;pointer-events:none;background:rgb(${slideMarkerColors[number].join(',')})"></div></body>`)
}

// Public HTTP commands deliberately oppose stored page numbers to geometry.
export async function prepareSlidesContainerOrder(api, query, slidesId, ids) {
  assert.equal(ids.length, 3)
  const before = await api('/api/canvas' + query)
  await api('/api/canvas/operations' + query, 'POST', { expectedRevision: before.revision, operations: [
    ...ids.map((id, i) => ({ type: 'update', id, changes: { meta: { cowartAiSlidesGeneratedPage: [3, 1, 2][i] } } })),
    { type: 'update', id: ids[2], changes: { x: 600 } },
  ] })
  const after = await api('/api/canvas' + query)
  assert.deepEqual([ids[0], ids[2], ids[1]].map(id => after.snapshot.store[id].x), [12, 1068, 2124])
  assert.deepEqual([after.snapshot.store[slidesId].props.w, after.snapshot.store[slidesId].props.h], [3160, 600])
  return { pageOrder: [1, 3, 2], shapeOrder: [ids[0], ids[2], ids[1]], revision: after.revision }
}

export async function deleteSlidesMiddle(api, query, slidesId, containerOrder) {
  const before = await api('/api/canvas' + query), removed = containerOrder.shapeOrder[1]
  await api('/api/canvas/operations' + query, 'POST', { expectedRevision: before.revision, operations: [{ type: 'delete', ids: [removed] }] })
  const after = await api('/api/canvas' + query), shapeOrder = [containerOrder.shapeOrder[0], containerOrder.shapeOrder[2]]
  assert.equal(after.snapshot.store[removed], undefined)
  assert.deepEqual(shapeOrder.map(id => after.snapshot.store[id].x), [12, 1068])
  assert.deepEqual([after.snapshot.store[slidesId].props.w, after.snapshot.store[slidesId].props.h], [2104, 600])
  return { pageOrder: [containerOrder.pageOrder[0], containerOrder.pageOrder[2]], shapeOrder, removed, revision: after.revision }
}

const pageNames = (order, extension) => order.map((_, i) => `page-${String(i + 1).padStart(2, '0')}.${extension}`)
export async function verifyOfflineSlidesOrder(directory, order) {
  const names = pageNames(order, 'html'), observations = []
  for (const [i, name] of names.entries()) {
    const html = await readFile(join(directory, 'pages', name), 'utf8')
    assert.match(html, new RegExp(`window\\.slideNumber=${order[i]};`), `${name}内容顺序错误`)
    assert.ok(html.includes(`<title>合成幻灯片 ${order[i]}</title>`), `${name}标题不匹配`)
    observations.push({ name, originalNumber: order[i] })
  }
  const player = await readFile(join(directory, 'Play.html'), 'utf8'), match = player.match(/hiCanvasOfflineSlides\(\{pages:(\[[^\]]+\])/)
  assert.ok(match, '实际播放器没有页文件列表')
  assert.deepEqual(JSON.parse(match[1]), names.map(name => 'pages/' + name))
  return { pages: observations, playerOrderVerified: true }
}

export async function verifySlidesPngOrder(exported, order, decodeImage) {
  assert.deepEqual(exported.results.map(r => r.fileName), pageNames(order, 'png'))
  const observations = []
  for (const [i, result] of exported.results.entries()) {
    assert.equal(basename(result.filePath), result.fileName)
    const { width, height, rgba } = await decodeImage(await readFile(result.filePath))
    assert.ok(width >= 1024 && height >= 576, '逐页PNG尺寸不足')
    const rgb = rgba.slice(0, 3)
    assert.deepEqual(rgb, slideMarkerColors[order[i]], `${result.fileName} 实际PNG颜色与作品页不符`)
    assert.equal(rgba[3], 255)
    observations.push({ name: result.fileName, originalNumber: order[i], rgb, width, height })
  }
  return observations
}
