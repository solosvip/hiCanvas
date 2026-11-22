const navigation = new WeakMap()

export function attachCanvasNavigation(editor, { save, didSave }) {
  const flush = async () => {
    const before = editor.store.getStoreSnapshot()
    const result = await save()
    if (result?.ok === false) throw new Error(result.message || '画板未能保存。')
    const saved = result?.snapshot?.store || before.store
    const current = editor.store.getStoreSnapshot().store
    if (Object.keys(current).length !== Object.keys(saved).length || Object.entries(current).some(([id, record]) => JSON.stringify(record) !== JSON.stringify(saved[id]))) throw new Error('保存期间画板又有修改，请稍后再切换。')
    didSave()
  }
  navigation.set(editor, flush)
  return () => { if (navigation.get(editor) === flush) navigation.delete(editor) }
}

export async function prepareCanvasNavigation(editor) {
  const flush = navigation.get(editor)
  if (!flush) throw new Error('画板尚未准备好，请稍后再试。')
  await flush()
}
