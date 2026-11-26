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
