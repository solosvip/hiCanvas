import test from 'node:test'
import assert from 'node:assert/strict'
import { attachCanvasNavigation, prepareCanvasNavigation } from '../src/canvasNavigation.js'

test('切换对话先等待保存并清除未保存提示；保存失败或期间继续编辑时保留当前页', async () => {
  let store = { a: { id: 'a', text: '原内容' } }, didSave = 0
  const editor = { store: { getStoreSnapshot: () => ({ store }) } }
  const release = attachCanvasNavigation(editor, { save: async () => ({ ok: true, snapshot: { store } }), didSave: () => didSave++ })
  await prepareCanvasNavigation(editor)
  assert.equal(didSave, 1)
  release()
  await assert.rejects(prepareCanvasNavigation(editor), /尚未准备/)
  attachCanvasNavigation(editor, { save: async () => { throw new Error('断网') }, didSave: () => didSave++ })
  await assert.rejects(prepareCanvasNavigation(editor), /断网/)
  attachCanvasNavigation(editor, { save: async () => { const snapshot = { store }; store = { a: { id: 'a', text: '保存中又改了' } }; return { ok: true, snapshot } }, didSave: () => didSave++ })
  await assert.rejects(prepareCanvasNavigation(editor), /又有修改/)
  assert.equal(didSave, 1)
})
