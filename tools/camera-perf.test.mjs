import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { measureCameraNavigation } from './renderer-preview/camera-perf.mjs'

test('相机性能探针中途失败仍停帧、松鼠标和清除监听，同步清理异常不覆盖原错误', async () => {
  const contents = new EventEmitter(), primary = new Error('native input failed')
  let failed = false, held = false, stopped = false, released = false, reset = false
  contents.executeJavaScript = script => {
    if (failed) {
      if (script.includes('function stopFrames')) stopped = true
      if (script.includes('function resetCamera')) reset = true
      throw new Error('cleanup target gone')
    }
    if (script.includes('function getCamera')) return Promise.resolve({ x: 0, y: 0, z: 1 })
    return Promise.resolve()
  }
  contents.sendInputEvent = event => {
    if (event.type === 'mouseDown') held = true
    if (event.type === 'mouseMove' && held) { failed = true; throw primary }
    if (event.type === 'mouseUp') { held = false; released = true }
  }
  await assert.rejects(measureCameraNavigation({ webContents: contents }, { camera: { x: 0, y: 0, z: 1 }, renderer: 'legacy' }), error => error === primary)
  assert.ok(stopped && released && reset)
  assert.equal(held, false)
  assert.equal(contents.listenerCount('paint'), 0)
})
