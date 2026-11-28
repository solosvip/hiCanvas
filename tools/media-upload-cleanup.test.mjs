import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as turn } from 'node:timers/promises'
import { createConversations } from '../server/conversations.mjs'
import { createCanvasMedia } from '../server/canvas-media.mjs'
import { createEditorSession } from '../engine/index.js'
import { createMediaUpload } from './renderer-preview/media-upload.js'
import { decodeImageUpload } from '../server/image-upload.mjs'
import { rasterFiles } from './renderer-preview/image-fixtures.js'

class Reader {
  readAsDataURL(file) { void file.arrayBuffer().then(bytes => { if (!this.aborted) { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload?.() } }) }
  abort() { this.aborted = true; this.onabort?.() }
}
async function setup(t, mode = '') {
  const root = await mkdtemp(join(tmpdir(), 'media-host-cleanup-')), workspace = createConversations(root), { id } = await workspace.open()
  const media = createCanvasMedia(workspace), errors = [], uploaded = [], requests = [], originalTimeout = AbortSignal.timeout.bind(AbortSignal), timeout = new AbortController()
  let commits = 0, finals = 0, selection = [], entered, release, token
  const reached = new Promise(r => { entered = r }), gate = new Promise(r => { release = r })
  t.mock.method(AbortSignal, 'timeout', ms => ms === 60000 ? timeout.signal : originalTimeout(ms))
  const readerProperty = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  Object.defineProperty(globalThis, 'FileReader', { value: Reader, configurable: true })
  t.after(() => { if (readerProperty) Object.defineProperty(globalThis, 'FileReader', readerProperty); else delete globalThis.FileReader })
  const session = await createEditorSession({ actor: 'ui:cleanup', transport: {
    read: () => workspace.read(id), subscribe: () => () => {},
    async commit({ expectedRevision, commands, actor, recordBasis }) {
      commits++
      if (mode === 'commit-timeout') { entered(); await gate }
      if (mode === 'replay' && commits === 1) await workspace.submitCommands(id, expectedRevision, 'mcp:other', () => [{ type: 'create_shape', id: 'shape:unrelated', shapeType: 'geo' }])
      if (mode === 'reject-commit') throw new Error('原始提交拒绝')
      let result
      try { result = await workspace.submitCommands(id, expectedRevision, actor, () => commands, { recordBasis }) }
      catch (error) { if (error.status === 409) error.code = 'conflict'; throw error }
      if (mode === 'lost-commit') throw new Error('原始提交回执丢失')
      return result
    },
  } })
  const doc = { createElement: tag => ({
    videoWidth: 320, videoHeight: 180, load() {}, removeAttribute() {},
    set src(value) {
      if (tag === 'video') { queueMicrotask(() => this.onloadedmetadata?.()); return }
      const image = decodeImageUpload(value); this.naturalWidth = image.w; this.naturalHeight = image.h
      queueMicrotask(() => this.onload?.())
    },
  }) }
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const args = JSON.parse(options.body); requests.push(args)
    if (args.purpose === 'file-import-abort' && mode === 'cleanup-fail') throw new Error('synthetic EACCES')
    if (args.purpose === 'file-import-abort') assert.equal(options.signal.aborted, false, '取消不能复用已结束signal')
    const final = args.dataUrl && args.purpose !== 'file-import-prepare'
    if (final && ++finals === 2 && mode === 'second-fail') return Response.json({ error: '原始第二项上传失败' }, { status: 503 })
    const result = await media.reference(id, args, 'ui:cleanup')
    if (args.purpose === 'file-import-begin') token = result.importToken
    if (final) {
      uploaded.push(result)
      if (['dispose', 'timeout', 'selection'].includes(mode)) { entered(); await gate }
      if (mode === 'lost-upload') throw new Error('原始上传回执丢失')
    }
    return Response.json(result)
  })
  const upload = createMediaUpload({ session, interaction: { state: { get: () => ({ selectedIds: selection, camera: { x: 0, y: 0, z: 1 } }) } }, metadata: { persistent: true, actor: 'ui:cleanup', conversationId: id, viewState: { currentPageId: Object.values(session.store.getStoreSnapshot().store).find(r => r.typeName === 'page').id } }, document: doc, onError: error => errors.push(error.message) })
  t.after(async () => { release(); upload.dispose(); session.dispose(); if (token) await media.reference(id, { purpose: 'file-import-abort', importToken: token }, 'ui:cleanup').catch(() => {}); await rm(root, { recursive: true, force: true }) })
  const files = () => ['png', 'jpeg'].map(key => new File([Buffer.from(rasterFiles[key].base64, 'base64')], 'synthetic.' + key, { type: rasterFiles[key].mimeType }))
  return { upload, errors, uploaded, requests, files, workspace, id, session, root, reached, release, timeout, select: () => { selection = ['shape:changed'] }, count: () => readdir(join(root, 'conversations', id, 'assets')).catch(() => []), commits: () => commits }
}
for (const mode of ['second-fail', 'lost-upload', 'reject-commit']) test(`${mode}立即提示原错误并清理本次全部已上传文件`, async t => {
  const f = await setup(t, mode), before = await f.workspace.read(f.id)
  assert.equal(await f.upload.importFiles(f.files(), { x: 0, y: 0 }), false)
  assert.ok(f.errors[0].includes('原始'))
  assert.deepEqual(await f.count(), []); assert.deepEqual(await f.workspace.read(f.id), before)
  assert.equal(f.requests.filter(r => r.purpose === 'file-import-abort').length, 1)
})
for (const mode of ['dispose', 'timeout', 'selection']) test(`上传已落盘但尚未回执时${mode}，清理不依赖响应URL且销毁后不报UI`, async t => {
  const f = await setup(t, mode), pending = f.upload.importFiles(f.files().slice(0, 1), { x: 0, y: 0 })
  await f.reached
  if (mode === 'dispose') f.upload.dispose(); else if (mode === 'timeout') f.timeout.abort(new Error('原始导入超时')); else f.select()
  f.release(); assert.equal(await pending, false)
  assert.deepEqual(await f.count(), []); assert.equal(f.commits(), 0)
  if (mode === 'dispose') assert.deepEqual(f.errors, [])
})
test('提交已保存但回执丢失，宿主清理不删已提交文件，随后撤销重做正常', async t => {
  const f = await setup(t, 'lost-commit')
  assert.equal(await f.upload.importFiles(f.files(), { x: 0, y: 0 }), false)
  assert.equal((await f.count()).length, 2)
  let current = await f.workspace.read(f.id)
  assert.equal(Object.values(current.snapshot.store).filter(r => r.typeName === 'shape').length, 2)
  current = await f.workspace.undo(f.id, current.revision, 'ui:cleanup')
  current = await f.workspace.redo(f.id, current.revision, 'ui:cleanup')
  for (const file of f.uploaded) await access(file.assetPath)
})
test('清理失败不遮住已展示的原始提交错误，附加提示也含原错误', async t => {
  const f = await setup(t, 'cleanup-fail')
  // Force a final ticket refusal after a successful upload.
  const pending = f.upload.importFiles(f.files(), { x: 0, y: 0 })
  f.select(); assert.equal(await pending, false)
  assert.ok(f.errors[0].includes('选择'))
  assert.ok(f.errors.at(-1).includes('选择') && f.errors.at(-1).includes('未完全清理'))
})
test('正常成功只提交一次，销毁不取消已保存的素材', async t => {
  const f = await setup(t)
  assert.equal(await f.upload.importFiles(f.files(), { x: 0, y: 0 }), true)
  f.upload.dispose(); await turn()
  assert.equal(f.commits(), 1); assert.equal((await f.count()).length, 2)
  assert.equal(f.requests.filter(r => r.purpose === 'file-import-abort').length, 0)
})

test('无关远端变化由服务端按记录核对，一次提交成功且素材不提前清理', async t => {
  const f = await setup(t, 'replay')
  assert.equal(await f.upload.importFiles(f.files(), { x: 0, y: 0 }), true)
  assert.equal(f.commits(), 1); assert.deepEqual(f.errors, [])
  assert.equal(f.requests.filter(r => r.purpose === 'file-import-abort').length, 0)
  assert.equal((await f.count()).length, 2)
  assert.equal(Object.values((await f.workspace.read(f.id)).snapshot.store).filter(r => r.typeName === 'shape').length, 3)
})


test('60秒总时限也覆盖提交等待；取消先完成后迟到提交不能保存空引用', async t => {
  const f = await setup(t, 'commit-timeout'), before = await f.workspace.read(f.id)
  const pending = f.upload.importFiles(f.files(), { x: 0, y: 0 })
  await f.reached
  f.timeout.abort(new Error('原始提交等待超时'))
  const completed = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))])
  f.release()
  assert.equal(completed, false)
  for (let i = 0; i < 8; i++) await turn()
  assert.deepEqual(await f.count(), [])
  assert.deepEqual(await f.workspace.read(f.id), before)
})
