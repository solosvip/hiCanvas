import {updateCowartHtmlDraft} from '../cowartClient.js'
import {htmlContentIdentity,mergeHtmlEditSnapshot} from '../htmlEditMerge.js'
import {applyRemoteCanvasSnapshot} from './remoteSync.js'

// Created once per isolated edit session. Even a poll that already accepted a
// newer server revision cannot silently turn an old HTML draft into an overwrite.
export function createHtmlEditPersistence(editor,draftShapeId,applyResult){
  let expectedContent=htmlContentIdentity(editor.getShape(draftShapeId))
  return async htmlContent=>{
    expectedContent=await expectedContent
    const result=await updateCowartHtmlDraft({draftShapeId,htmlContent},{expectedContent,applyResult:result=>applyResult(result,htmlContent),
      async reconcile(latest,baseline,assertCurrent){
        const current=editor.store.getStoreSnapshot()
        const merged=await mergeHtmlEditSnapshot(baseline,latest,current,draftShapeId,expectedContent)
        if(JSON.stringify(editor.store.getStoreSnapshot())!==JSON.stringify(current))throw new Error('合并期间本地画板已变化，网页草稿仍保留，请重试。')
        assertCurrent() // Check before applying, even if a newer poll restored identical records.
        if(applyRemoteCanvasSnapshot(editor,merged).skippedRecords.length)throw new Error('最新画板不能完整合并，网页草稿仍保留。')
        return true
      },
    })
    if(result?.shapeRecord)expectedContent=await htmlContentIdentity(result.shapeRecord)
    return result
  }
}
