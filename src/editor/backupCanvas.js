import { downloadCowartFile } from '../cowartClient.js'

export async function backupCanvas(editor) {
  const json = JSON.stringify(editor.store.getStoreSnapshot(), null, 2)
  const backupStore = JSON.parse(json).store
  const downloaded = await downloadCowartFile({
    fileName: `hicanvas-unsaved-${Date.now()}.json`, mimeType: 'application/json',
    dataUrl: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`
  })
  if (!downloaded?.ok) throw new Error('备份未保存，请重试。')
  return backupStore
}
