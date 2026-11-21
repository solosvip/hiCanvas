// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { useEditor, useValue } from "tldraw"
import { isAiSlidesShape, isCowartHtmlDraftEmbedShape } from './holderMeta.jsx'
import { CowartSlidesToolbar } from './slidesToolbar.jsx'
import { CowartHtmlDraftToolbar } from './htmlToolbar.jsx'
import { CowartImageToolbar } from './imageToolbar.jsx'
function CowartSelectionToolbar() {
  const editor = useEditor()
  const slidesShapeId = useValue(
    'cowart selected ai slides toolbar shape id',
    () => {
      const shape = editor.getOnlySelectedShape()
      return isAiSlidesShape(shape) ? shape.id : null
    },
    [editor]
  )
  const htmlDraftShapeId = useValue(
    'cowart selected html draft toolbar shape id',
    () => {
      const shape = editor.getOnlySelectedShape()
      return isCowartHtmlDraftEmbedShape(shape) ? shape.id : null
    },
    [editor]
  )
  if (slidesShapeId) {
    return <CowartSlidesToolbar slidesShapeId={slidesShapeId} />
  }
  if (htmlDraftShapeId) {
    return <CowartHtmlDraftToolbar key={htmlDraftShapeId} draftShapeId={htmlDraftShapeId} />
  }
  return <CowartImageToolbar />
}
export { CowartSelectionToolbar }
