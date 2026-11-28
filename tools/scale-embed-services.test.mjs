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
test('Gist 只返回整份文档的隔离发布描述，不产生远端 iframe 地址', () => {
  assert.deepEqual(model.resolveEmbedUrl('https://gist.github.com/synthetic/ABC012?file=private.js#L5'), {
    id: 'G16', name: 'GitHub Gist', mode: 'isolated-gist', gistId: 'abc012',
    url: 'https://gist.github.com/synthetic/abc012', size: [720, 500],
  })
  assert.equal(resolveExternalEmbed('https://gist.github.com/synthetic/ABC012?file=private.js'), null)
  assert.equal(model.EMBED_SERVICES.find(service => service.id === 'G16').available, true)
})

test('Gist ID严格有界；只接两种完整HTTPS地址，路径不被二次解码或折叠', () => {
  assert.equal(model.normalizeGistId('A'.repeat(64)), 'a'.repeat(64))
  assert.equal(model.normalizeGistId('F'), 'f')
  for (const bad of [null, 12, '', 'abc\n', 'abc\r', ' abc', 'abc ', 'ＡＢ', '0x123', 'ab.js', 'a'.repeat(65)]) assert.equal(model.normalizeGistId(bad), null, String(bad))
  assert.deepEqual(model.parseGistUrl('https://gist.github.com/AB12/?file=a.js#x'), { gistId: 'ab12', url: 'https://gist.github.com/ab12' })
  for (const bad of [
    'http://gist.github.com/ab12', 'https://gist.github.com:444/ab12', 'https://user@gist.github.com/ab12',
    'https://gist.github.com.evil.invalid/ab12', 'https://gist.github.com./ab12', '//gist.github.com/ab12',
    'https://gist.githubusercontent.com/user/ab12/raw', 'https://gist.github.com/user/ab12.js',
    'https://gist.github.com/user/ab12/def', 'https://gist.github.com/user//ab12',
    'https://gist.github.com/user/%61b12', 'https://gist.github.com/user%2fab12',
    'https://gist.github.com/user%252fab12', 'https://gist.github.com/user/../ab12',
    'https://gist.github.com/user/%2e%2e/ab12', 'https://gist.github.com/-owner/ab12',
    'https://gist.github.com/' + 'a'.repeat(65), 'https://gist.github.com/user/ab12\n',
  ]) {
    assert.equal(model.parseGistUrl(bad), null, bad)
    assert.equal(model.resolveEmbedUrl(bad), null, bad)
    assert.equal(model.getEmbedService(bad), null, bad)
  }
  assert.deepEqual(model.getEmbedService('https://gist.github.com/ab12'), { id: 'G16', minWidth: 200, minHeight: 200, canResize: true, lockAspectRatio: false })
})

test('统一地址后旧版完整嵌入结果不变，仅Figma内层URL按审定正确编码', () => {
  assert.equal(baseline.length, externalSamples.length)
  externalSamples.forEach((sample, i) => {
    const result = resolveExternalEmbed(sample.input)
    if (sample.id === 'G06' && result) {
      const input = new URL(sample.input), expected = input.pathname === '/embed' ? input.searchParams.get('url') : sample.input
      assert.equal(new URL(result.src).searchParams.get('url'), expected)
      // Preserve the old whole-result hash after substituting only the one
      // approved address difference; service metadata/permissions remain exact.
      assert.equal(createHash('sha256').update(JSON.stringify({ ...result, src: sample.src })).digest('hex'), baseline[i], sample.input)
    } else assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), baseline[i], sample.input)
  })
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
