import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as model from '../model/index.js'
import { resolveExternalEmbed } from '../renderer/embed-content.js'
import { externalSamples } from './renderer-preview/external-samples.js'

const baseline = JSON.parse(readFileSync(new URL('./fixtures/embed-resolution-hashes.json', import.meta.url), 'utf8'))
test('提取来源识别后全部旧版样本的完整嵌入结果逐字不变', () => {
  assert.equal(baseline.length, externalSamples.length)
  externalSamples.forEach((sample, i) => assert.equal(createHash('sha256').update(JSON.stringify(resolveExternalEmbed(sample.input))).digest('hex'), baseline[i], sample.input))
})

test('编辑和渲染共用只读来源约束，Scratch 不可缩放，影片来源默认锁比例', () => {
  assert.equal(typeof model.getEmbedService, 'function')
  const scratch = model.getEmbedService('https://scratch.mit.edu/projects/123456789')
  assert.deepEqual(scratch, { id: 'G12', minWidth: 200, minHeight: 200, canResize: false, lockAspectRatio: false })
  assert.ok(Object.isFrozen(scratch))
  const youtube = model.getEmbedService('https://youtu.be/synthetic83?t=90')
  assert.deepEqual(youtube, { id: 'G13', minWidth: 200, minHeight: 200, canResize: true, lockAspectRatio: true })
  assert.equal(model.getEmbedService('https://www.youtube.com/shorts/abc'), null)
  assert.equal(model.getEmbedService('http://www.youtube.com/watch?v=abc'), null)
  assert.equal(model.getEmbedService('https://user@www.youtube.com/watch?v=abc'), null)
})

for (const mode of ['resize_bounds', 'scale_shape']) test(`${mode}：普通内嵌页保持自由比例，视频来源默认锁比例，显式选项可覆盖`, async () => {
  const { fixture, subject, scale } = await import('./scale-fixtures.mjs')
  const generic = fixture('embed', { w: 320, h: 240, url: 'https://example.invalid/synthetic' })
  const normal = scale(generic, { x: 420 / 320, y: 270 / 240 }, { mode }).snapshot.store[subject]
  assert.deepEqual([normal.x, normal.y, normal.props.w, normal.props.h], [300, 250, 420, 270])
  const video = fixture('embed', { w: 320, h: 240, url: 'https://youtu.be/synthetic83' })
  const locked = scale(video, { x: 420 / 320, y: 270 / 240 }, { mode }).snapshot.store[subject]
  assert.deepEqual([locked.props.w, locked.props.h], [420, 315])
  const unlocked = scale(video, { x: 420 / 320, y: 270 / 240 }, { mode, lockAspectRatio: false }).snapshot.store[subject]
  assert.deepEqual([unlocked.props.w, unlocked.props.h], [420, 270])
})

test('18来源的原生最小尺寸和不可缩放策略，含默认比例约束', async () => {
  const { fixture, subject, scale, near } = await import('./scale-fixtures.mjs')
  const minimums = [[300,300],[200,200],[200,200],[200,200],[260,100],[300,300],[300,300],[320,240],[266.66666666666663,200],[460,360],[460,360],[200,200],[200,200],[200,200],[200,500],[266.66666666666663,200],[200,200],[200,200]]
  const samples = externalSamples.filter(s => s.kind === 'base')
  samples.forEach((sample, i) => {
    const before = fixture('embed', { w: 320, h: 240, url: sample.input })
    const shape = scale(before, { x: 2 / 320, y: 2 / 240 }).snapshot.store[subject]
    near(shape.props.w, minimums[i][0]); near(shape.props.h, minimums[i][1])
    if (sample.id === 'G12') assert.deepEqual(shape, before.store[subject])
  })
})

test('显式解锁仍保留 YouTube/Vimeo 的固有最小外框比例', async () => {
  const { fixture, subject, scale, near } = await import('./scale-fixtures.mjs')
  for (const url of ['https://youtu.be/synthetic83', 'https://vimeo.com/123456789']) {
    const before = fixture('embed', { w: 320, h: 240, url })
    const shape = scale(before, { x: .001, y: .002 }, { lockAspectRatio: false }).snapshot.store[subject]
    // Legacy public resizeShape with explicit unlock, 2026-11-25.
    near(shape.props.w, 266.66666666666663); near(shape.props.h, 200)
  }
})
