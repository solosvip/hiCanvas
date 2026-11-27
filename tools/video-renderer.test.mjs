import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Video } from '../renderer/video.js'

test('无assetId及无会话播放项的视频显示占位，不能在读取time时崩溃', () => {
  const html = renderToStaticMarkup(createElement(Video, { scene: { store: { get: () => undefined } }, shape: { id: 'shape:missing', props: { w: 320, h: 180 } } }))
  assert.match(html, /视频不可用/); assert.doesNotMatch(html, /<video/)
})
test('有资产但来源为外部URL的视频仍显示占位，不挂src发请求', () => {
  const html = renderToStaticMarkup(createElement(Video, { scene: { store: { get: () => ({ type: 'video', props: { src: 'https://example.invalid/a.mp4', name: 'external' } }) } }, shape: { id: 'shape:external', props: { w: 320, h: 180, assetId: 'asset:external', time: 0 } } }))
  assert.match(html, /视频不可用/); assert.doesNotMatch(html, /src=/)
})
