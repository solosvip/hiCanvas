import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentRequests } from './agent-requests.mjs'
import { executeCanvasCommands } from '../engine/index.js'
import { fixture } from './test-helpers.mjs'

async function edit(workspace, id, commands) {
  const current = await workspace.read(id)
  return workspace.mutate(id, current.revision, snapshot => executeCanvasCommands(snapshot, commands).snapshot)
}

async function setup(t) {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  await edit(workspace, id, [
    { type: 'create_shape', id: 'shape:target', shapeType: 'frame', props: { name: '原框' }, meta: { cowartAiDraftHolder: true, userNote: { text: '原注释' } } },
    { type: 'create_shape', id: 'shape:other', shapeType: 'geo', meta: { userNote: '其他形状' } },
  ])
  return { workspace, id }
}

const delivery = { deliver: async () => ({ status: 'waiting' }) }
const input = { prompt: '生成合成网页', context: { targetShapeId: 'shape:target' } }
const userEdits = [
  { type: 'update', id: 'shape:target', changes: { x: 460, y: 230, props: { name: '用户改名', w: 720 }, meta: { userNote: { text: '用户的新注释' }, customTag: ['保留'] } } },
  { type: 'update', id: 'shape:other', changes: { x: 910, props: { w: 330 }, meta: { userNote: '用户也改了别的形状' } } },
]

function freeze(value) {
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object') freeze(nested)
  return Object.freeze(value)
}

test('请求状态标记从只读输入快照产生新数据，不就地修改宿主记录', async t => {
  const { workspace, id } = await setup(t)
  const requests = createAgentRequests({
    ...workspace,
    mutate: (id, revision, transform) => workspace.mutate(id, revision, snapshot => {
      const before = structuredClone(snapshot)
      freeze(snapshot)
      const result = transform(snapshot)
      assert.deepEqual(snapshot, before, '请求模块不得修改宿主传入的快照')
      return result
    }),
  }, delivery)
  const submitted = await requests.submit(id, input)
  assert.equal((await workspace.read(id)).snapshot.store['shape:target'].meta.hicanvasGeneration.status, 'waiting')
  await requests.list(id, { claimBy: 'agent-test' })
  assert.equal((await workspace.read(id)).snapshot.store['shape:target'].meta.hicanvasGeneration.status, 'working')
  await requests.complete(id, submitted.id, { claimBy: 'agent-test', status: 'completed' })
  assert.deepEqual((await workspace.read(id)).snapshot.store['shape:target'].meta.hicanvasGeneration, { requestId: submitted.id, status: 'completed' })
})

for (const status of ['completed', 'failed']) {
  test(`请求 ${status} 时只更新标记，保留用户交错修改的同框属性、元数据和其他形状`, async t => {
    const { workspace, id } = await setup(t)
    const requests = createAgentRequests(workspace, delivery)
    const submitted = await requests.submit(id, input)
    await requests.list(id, { claimBy: 'agent-test' })
    const userResult = await edit(workspace, id, userEdits)
    const message = status === 'failed' ? '合成失败说明' : ''
    const completed = await requests.complete(id, submitted.id, { claimBy: 'agent-test', status, message })
    assert.equal(completed.id, submitted.id)
    assert.equal(completed.status, status)
    assert.equal(completed.message, message)
    const expected = structuredClone(userResult.snapshot)
    expected.store['shape:target'].meta.hicanvasGeneration = { requestId: submitted.id, status, ...(message ? { error: message } : {}) }
    const result = await workspace.read(id)
    assert.notEqual(result.revision, userResult.revision)
    assert.deepEqual(result.snapshot, expected, '完成请求不得覆盖用户对任何形状的编辑')
    assert.deepEqual(await requests.list(id), [], '终态请求不再被领取')
  })
}

test('标记保存遭遇真实版本冲突后重读重试，保留冲突期间用户改动且始终携带版本', async t => {
  const { workspace, id } = await setup(t)
  let interleave = false, userResult
  const readVersions = [], attemptedVersions = []
  const requests = createAgentRequests({
    ...workspace,
    async read(id) {
      const current = await workspace.read(id)
      readVersions.push(current.revision)
      return current
    },
    async mutate(id, revision, transform) {
      attemptedVersions.push(revision)
      if (interleave) {
        interleave = false
        // 在请求读完、持久化前插入真正的用户事务，让存储层拒绝旧版本。
        userResult = await edit(workspace, id, userEdits)
      }
      return workspace.mutate(id, revision, transform)
    },
  }, delivery)
  const submitted = await requests.submit(id, input)
  const before = await workspace.read(id)
  readVersions.length = 0
  attemptedVersions.length = 0
  interleave = true
  await requests.complete(id, submitted.id, { status: 'completed' })
  assert.ok(userResult, '必须在标记保存前发生一次用户编辑')
  assert.deepEqual(readVersions, [before.revision, userResult.revision], '冲突后必须重新读取最新版本')
  assert.deepEqual(attemptedVersions, readVersions, '每次写入使用刚读取的版本，不能省略版本强制重试')
  const expected = structuredClone(userResult.snapshot)
  expected.store['shape:target'].meta.hicanvasGeneration = { requestId: submitted.id, status: 'completed' }
  assert.deepEqual((await workspace.read(id)).snapshot, expected)
})

for (const replacement of [false, true]) {
  test(`目标框${replacement ? '被替换成其他形状' : '已删除'}后完成请求跳过标记，不复活或覆盖用户内容`, async t => {
    const { workspace, id } = await setup(t)
    const requests = createAgentRequests(workspace, delivery)
    const submitted = await requests.submit(id, input)
    const commands = [{ type: 'delete', ids: ['shape:target'] }]
    if (replacement) commands.push({ type: 'create_shape', id: 'shape:target', shapeType: 'geo', meta: { userNote: '用户的新形状' } })
    const userResult = await edit(workspace, id, commands)
    const completed = await requests.complete(id, submitted.id, { status: 'completed' })
    assert.equal(completed.status, 'completed')
    const result = await workspace.read(id)
    assert.equal(result.revision, userResult.revision, '没有目标框时不产生无用画板写入')
    assert.deepEqual(result.snapshot, userResult.snapshot)
  })
}
