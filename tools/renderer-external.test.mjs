import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveExternalEmbed, EXTERNAL_EMBED_SERVICES } from '../renderer/embed-content.js'
import { externalSamples } from './renderer-preview/external-samples.js'
import { createCanvasStore } from '../model/index.js'
import { createExternalGallery } from './renderer-preview/external-gallery.js'
import { createBookmarkGallery } from './renderer-preview/bookmark-gallery.js'

for (const [i, sample] of externalSamples.entries()) test(`旧版黑盒样本 ${i + 1} ${sample.id}：${sample.input}`, () => {
  const result = resolveExternalEmbed(sample.input)
  assert.equal(result?.src || null, sample.src)
  if (!sample.src) return
  assert.equal(result.service.id, sample.id)
  assert.deepEqual(result.service.size, sample.size)
  assert.equal(result.attributes.sandbox, sample.attributes.sandbox)
  assert.equal(result.attributes.referrerPolicy, sample.attributes.referrerpolicy)
  assert.equal(result.attributes.allow || null, sample.attributes.allow)
  assert.equal(result.attributes.allowFullScreen, sample.attributes.allowfullscreen !== null)
})

test('未知、伪造主机、凭据或未经采样的地址形式不加载外部页面', () => {
  for (const url of [null, '', 'not-a-url', 'javascript:alert(83)', 'data:text/html,hello', '//www.youtube.com/watch?v=synthetic83', 'https://www.youtube.com.evil.test/watch?v=synthetic83', 'https://www.youtube.com@evil.test/watch?v=synthetic83', 'https://user:pass@www.youtube.com/watch?v=synthetic83', 'https://www.youtube.com:444/watch?v=synthetic83', 'https://www.youtube.com/unknown/synthetic83']) assert.equal(resolveExternalEmbed(url), null, url)
})

test('18 项服务记录观察所得尺寸与约束；Gist 包装留待 #78', () => {
  assert.equal(EXTERNAL_EMBED_SERVICES.length, 18)
  const service = id => EXTERNAL_EMBED_SERVICES.find(entry => entry.id === id)
  assert.deepEqual(service('G05').size, [720, 500])
  assert.deepEqual(service('G13').size, [800, 450])
  assert.equal(service('G12').canResize, false)
  assert.equal(service('G13').lockAspectRatio, true)
  assert.equal(service('G20').lockAspectRatio, true)
  assert.equal(service('G19').lockAspectRatio, false)
  assert.deepEqual(service('G19').minimumObserved, [200, 500])
  assert.equal(service('G16').fallbackIssue, 78)
})

test('外部服务与书签离线图鉴使用可加载的合成记录，包含缺元数据回退', () => {
  for (const create of [createExternalGallery, createBookmarkGallery]) {
    const fixture = create(), store = createCanvasStore()
    store.loadStoreSnapshot(fixture.snapshot)
    assert.equal(store.allRecords().filter(record => record.typeName === 'shape').length, fixture.count)
    assert.equal(Object.values(fixture.counts).reduce((a, b) => a + b, 0), fixture.count)
  }
  const gallery = createBookmarkGallery()
  assert.equal(gallery.snapshot.store['asset:bookmark-missing-asset'], undefined)
  assert.equal(gallery.snapshot.store['shape:bookmark-short'].props.h, 46)
})
