import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'
import { strokeProps } from './renderer-preview/stroke-fixtures.js'

const edit = (snapshot, commands) => executeCanvasCommands(snapshot, commands)
const link = (id, url) => ({ type: 'set_shape_link', id, url })
const shape = type => edit(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:linked', shapeType: type }]).snapshot

test('四类附加链接只改 props.url，清除不改身份、媒体资产或几何', () => {
  for (const type of ['geo', 'note', 'image', 'video']) {
    const before = shape(type), original = before.store['shape:linked']
    const result = edit(before, [link(original.id, ' HTTPS://EXAMPLE.INVALID/links?q=1#part ')])
    assert.deepEqual(result.snapshot.store[original.id], { ...original, props: { ...original.props, url: 'https://example.invalid/links?q=1#part' } })
    assert.deepEqual(Object.keys(result.changes.updated), [original.id])
    const cleared = edit(result.snapshot, [link(original.id, '')])
    assert.deepEqual(cleared.snapshot, before)
  }
})

test('命令不补协议，拒绝内容地址类型、缺失目标和危险/畸形网址，失败整批回滚', () => {
  const before = shape('geo'), unchanged = structuredClone(before)
  for (const url of [null, 1, {}, 'example.invalid', '/relative', '//example.invalid', 'javascript:void(0)', 'data:text/plain,a', 'file:///a', 'mailto:a@example.invalid', 'https://user:pass@example.invalid', 'http://example.invalid:3000', 'https://exa mple.invalid', 'https://example.invalid/\\bad', 'https://example.invalid/\u0000x', 'https://example.invalid/' + 'x'.repeat(8192)]) {
    assert.throws(() => edit(before, [link('shape:linked', 'https://example.invalid/ok'), link('shape:linked', url)]), String(url))
    assert.deepEqual(before, unchanged)
  }
  assert.throws(() => edit(before, [link('shape:missing', '')]), /不支持/)
  for (const type of ['text', 'line', 'arrow', 'draw', 'highlight', 'frame', 'group', 'bookmark', 'embed']) {
    // Put the rejected command in the same transaction as creation; empty groups
    // are otherwise reconciled away, and cannot serve as a group-type negative.
    let create = { type: 'create_shape', id: 'shape:other', shapeType: type }
    if (['draw', 'highlight'].includes(type)) create = { type: 'put', record: { ...before.store['shape:linked'], id: 'shape:other', type, props: strokeProps(type) } }
    if (type === 'bookmark') create = { type: 'insert_url', id: 'shape:other', url: 'https://example.invalid/bookmark' }
    assert.throws(() => edit(createCanvasSnapshot(), [create, link('shape:other', 'https://example.invalid/no')]), /不支持/)
  }
})

test('规范化等价保留旧拼写、空白清除和已空清除均不产生净变化', () => {
  const before = edit(shape('geo'), [{ type: 'update', id: 'shape:linked', changes: { props: { url: 'HTTPS://EXAMPLE.INVALID/same' } } }]).snapshot
  const result = edit(before, [link('shape:linked', ' https://example.invalid/same ')])
  assert.deepEqual(result.snapshot, before)
  assert.deepEqual(result.changes.updated, {})
  const cleared = edit(before, [link('shape:linked', ' \t\n')])
  assert.equal(cleared.snapshot.store['shape:linked'].props.url, '')
  assert.deepEqual(edit(cleared.snapshot, [link('shape:linked', '')]).changes.updated, {})
})

test('直接锁和三层祖先锁都原子拒绝；未锁孩子可以编辑', () => {
  const commands = ['outer', 'middle', 'inner'].map((id, i, all) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'frame', ...(i && { parentId: `shape:${all[i - 1]}` }) }))
  const before = edit(createCanvasSnapshot(), [...commands, { type: 'create_shape', id: 'shape:linked', shapeType: 'geo', parentId: 'shape:inner' }]).snapshot
  assert.equal(edit(before, [link('shape:linked', 'https://example.invalid/ok')]).snapshot.store['shape:linked'].props.url, 'https://example.invalid/ok')
  for (const id of ['outer', 'middle', 'inner', 'linked']) {
    const locked = edit(before, [{ type: 'update', id: `shape:${id}`, changes: { isLocked: true } }]).snapshot
    assert.throws(() => edit(locked, [link('shape:linked', 'https://example.invalid/no')]), /锁定/)
  }
})
