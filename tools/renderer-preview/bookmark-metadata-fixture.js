import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

// All preview boards are synthetic. Older suites receive empty data so their
// original history/notice expectations stay intact, with no target HTTP or DNS.
export function createBookmarkMetadataNetwork({ empty = false } = {}) {
  const requests = [], pending = new Map()
  let sequence = 0
  const reply = (url, marker) => ({ title: empty ? '' : `合成标题 ${marker}`, description: empty ? '' : '无图卡片的合成描述', url })
  function fetch(path, options) {
    if (path !== '/api/bookmark/metadata' || options.method !== 'POST') throw new Error('合成读取只能使用固定接口。')
    const { url, ...extra } = JSON.parse(options.body)
    if (Object.keys(extra).length || typeof url !== 'string') throw new Error('合成读取正文无效。')
    const item = { id: ++sequence, url, aborted: false, resolved: false }; requests.push(item)
    const respond = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    if (url.includes('127.0.0.1') || url.includes('private.example.invalid')) return Promise.resolve(new Response(JSON.stringify({ error: { code: 'target_not_public', message: 'SECRET response body' } }), { status: 422, headers: { 'content-type': 'application/json' } }))
    if (!empty && url.includes('delayed')) return new Promise(resolve => {
      const abort = () => { item.aborted = true }
      options.signal?.addEventListener('abort', abort, { once: true })
      pending.set(item.id, () => { options.signal?.removeEventListener('abort', abort); item.resolved = true; pending.delete(item.id); resolve(respond(reply(url, item.id))) })
    })
    item.resolved = true; return Promise.resolve(respond(reply(url, item.id)))
  }
  return { fetch, inspect: () => structuredClone(requests),
    release() { for (const finish of [...pending.values()]) finish() },
    dispose() { for (const finish of [...pending.values()]) finish() },
  }
}

export function createBookmarkMetadataFixture() {
  let snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'insert_url', id: 'shape:bookmark-a', url: 'https://old.example.invalid/card' }]).snapshot
  const a = snapshot.store['shape:bookmark-a'], asset = snapshot.store[a.props.assetId]
  snapshot = executeCanvasCommands(snapshot, [
    { type: 'update', id: a.id, changes: { x: 80, y: 80, props: { w: 300, h: 160 } } },
    { type: 'put', record: { ...a, id: 'shape:bookmark-peer', x: 430, y: 80, index: 'a8', props: { ...a.props, w: 300, h: 160 } } },
    { type: 'put', record: { ...asset, props: { ...asset.props, title: '原书签标题', description: '原描述' } } },
    { type: 'insert_url', id: 'shape:bookmark-compact', url: 'https://compact.example.invalid/card', point: { x: 230, y: 340 } },
  ]).snapshot
  const pageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id
  return { snapshot, count: 3, counts: { bookmark: 3 }, embedsFixture: true, bookmarkMetadataFixture: true, clipboardFixture: true,
    viewState: { currentPageId: pageId, camera: { x: 0, y: 0, z: 1 } } }
}
