import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './test-helpers.mjs'
import { createConversations } from './conversations.mjs'
import { createCanvasSnapshot, sanitizeCanvasSnapshot } from '../model/index.js'

// 由改动前锁定的编辑器生成并校验；内容全为合成数据，不读取真实画板。
const legacy = JSON.parse(await readFile(new URL('./fixtures/legacy-canvas.json', import.meta.url), 'utf8'))

test('MIT 数据层生成的初始文档和旧编辑器使用同一个 schema', () => {
  const initial = createCanvasSnapshot()
  assert.deepEqual(initial.schema, legacy.schema)
  assert.deepEqual(Object.keys(initial.store).sort(), ['document:document', 'page:page'])
  const validated = sanitizeCanvasSnapshot(legacy)
  assert.deepEqual(validated.skippedRecords, [])
  assert.deepEqual(validated.snapshot, legacy)
})

test('真实结构的旧快照经服务端读取、保存、重建服务后逐记录不变', async t => {
  const { workspace, root, api } = await fixture(t)
  const { id } = await workspace.open()
  const original = await workspace.read(id)
  const file = join(root, 'conversations', id, 'state.json')
  await writeFile(file, JSON.stringify({ revision: original.revision, snapshot: legacy }))
  const path = `/api/canvas?conversation=${id}`
  const read = await api(path)
  assert.equal(read.status, 200)
  assert.deepEqual(read.body.snapshot, legacy, '读取不得重建 schema 或丢掉资源、绑定、嵌套、富文本和 Cowart 元数据')
  const saved = await api(path, 'PUT', { expectedRevision: read.body.revision, snapshot: read.body.snapshot })
  assert.equal(saved.status, 200)
  assert.notEqual(saved.body.revision, original.revision)
  assert.deepEqual(saved.body.snapshot, legacy)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).snapshot, legacy)
  assert.deepEqual((await createConversations(root).read(id)).snapshot, legacy)
})

test('MIT 校验仍报告损坏记录和缺失依赖，不能静默丢内容', () => {
  const damaged = structuredClone(legacy)
  delete damaged.store['asset:synthetic']
  damaged.store['shape:geo'].props.w = 'invalid'
  const result = sanitizeCanvasSnapshot(damaged)
  for (const id of ['shape:geo', 'shape:image', 'binding:synthetic']) {
    assert.ok(result.skippedRecords.some(record => record.id === id), id)
    assert.equal(result.snapshot.store[id], undefined)
  }
})
