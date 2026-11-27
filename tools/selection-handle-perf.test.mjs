import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { measureSelectionHandles } from './renderer-preview/handle-perf.mjs'

test('性能输入失败仍停止采样、释放鼠标与监听；清理失败保留首个错误', async () => {
  const camera = { x: 0, y: 0, z: 1 }, original = new Error('native input failed'), contents = new EventEmitter(), inputs = []
  let sampling = false, downs = 0
  contents.executeJavaScript = async source => {
    if (source.includes('function startFrames')) sampling = true
    if (source.includes('function stopFrames')) sampling = false
    if (source.includes('const s=window.__HICANVAS_RENDERER_PREVIEW__')) return { selected: ['shape:perf-4999'], w: 96, h: 72, x: 0, y: 0, camera, mode: 'idle', snapshotReads: 0 }
  }
  contents.sendInputEvent = input => {
    inputs.push(input)
    if (input.type === 'mouseDown' && ++downs === 2) throw original
    if (input.type === 'keyDown') throw new Error('secondary cleanup failure')
  }
  await assert.rejects(measureSelectionHandles({ webContents: contents }, { renderer: 'preview', camera }), error => error === original)
  assert.equal(sampling, false)
  assert.equal(contents.listenerCount('paint'), 0)
  assert.equal(inputs.filter(i => i.type === 'mouseUp').length, 2)
  assert.ok(inputs.some(i => i.type === 'keyUp' && i.keyCode === 'Escape'))
})

test('手柄只有一帧时拒绝输出看似相同的FPS，仍取消和释放', async () => {
  const camera = { x: 0, y: 0, z: 1 }, contents = new EventEmitter()
  let resizing = false
  contents.executeJavaScript = async source => {
    if (source.includes('function stopFrames')) return { start: 0, end: 1000, times: [10] }
    if (source.includes('const s=window.__HICANVAS_RENDERER_PREVIEW__')) return { selected: ['shape:perf-4999'], w: resizing ? 100 : 96, h: resizing ? 76 : 72, x: 0, y: 0, camera, mode: resizing ? 'resizing' : 'idle', snapshotReads: 0, revision: '0', commitCalls: 0 }
  }
  let downs = 0
  contents.sendInputEvent = input => {
    if (input.type === 'mouseDown' && ++downs === 2) resizing = true
    if (input.type === 'mouseMove' && resizing) contents.emit('paint')
    if (input.type === 'keyDown' && input.keyCode === 'Escape') resizing = false
  }
  await assert.rejects(measureSelectionHandles({ webContents: contents }, { renderer: 'preview', camera, durationMs: 1 }), /有效绘制帧/)
  assert.equal(resizing, false)
  assert.equal(contents.listenerCount('paint'), 0)
})

test('重复选中点击进入编辑模式时拒绝开始手柄采样', async () => {
  const camera = { x: 0, y: 0, z: 1 }, contents = new EventEmitter()
  let resizing = false, downs = 0
  contents.executeJavaScript = async source => {
    if (source.includes('function stopFrames')) return { start: 0, end: 1000, times: [10, 20] }
    if (source.includes('const s=window.__HICANVAS_RENDERER_PREVIEW__')) return { selected: ['shape:perf-4999'], w: resizing ? 100 : 96, h: resizing ? 76 : 72, x: 0, y: 0, camera, mode: resizing ? 'resizing' : 'editing_text', snapshotReads: 0, revision: '0', commitCalls: 0 }
  }
  contents.sendInputEvent = input => {
    if (input.type === 'mouseDown' && ++downs === 2) resizing = true
    if (input.type === 'mouseMove' && resizing) { contents.emit('paint'); contents.emit('paint') }
    if (input.type === 'keyDown' && input.keyCode === 'Escape') resizing = false
  }
  await assert.rejects(measureSelectionHandles({ webContents: contents }, { renderer: 'preview', camera, durationMs: 1 }), /空闲选择/)
  assert.equal(contents.listenerCount('paint'), 0)
})
