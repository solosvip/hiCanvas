// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { ArrowDownToolbarItem, ArrowLeftToolbarItem, ArrowRightToolbarItem, ArrowToolbarItem, ArrowUpToolbarItem, AssetToolbarItem, CheckBoxToolbarItem, CloudToolbarItem, DiamondToolbarItem, DrawToolbarItem, EllipseToolbarItem, EraserToolbarItem, FrameToolbarItem, HandToolbarItem, HeartToolbarItem, HexagonToolbarItem, HighlightToolbarItem, LaserToolbarItem, LineToolbarItem, NoteToolbarItem, OvalToolbarItem, RectangleToolbarItem, RhombusToolbarItem, SelectToolbarItem, StarToolbarItem, TextToolbarItem, TldrawUiMenuToolItem, TriangleToolbarItem, XBoxToolbarItem, useEditor, useValue } from "tldraw"
import { CowartDraggableToolbar } from "../CowartDraggableToolbar.jsx"
import { ANNOTATION_TOOL_ID, ANNOTATION_TOOL_LABEL, annotationToolIcon, AI_IMAGE_TOOL_ID, AI_DRAFT_TOOL_ID, AI_FILM_TOOL_ID, AI_SLIDES_TOOL_ID } from './configuration.jsx'
import { unlockGlobalToolLock } from './annotationEditing.jsx'
function CowartToolbarItem({ toolId }) {
  const editor = useEditor()
  const isSelected = useValue(
    `is ${toolId} selected`,
    () => editor.getCurrentToolId() === toolId,
    [editor, toolId]
  )
  return <TldrawUiMenuToolItem toolId={toolId} isSelected={isSelected} />
}
function CowartAnnotationToolbarItem() {
  const editor = useEditor()
  const isSelected = useValue(
    'is annotation selected',
    () => editor.getCurrentToolId() === ANNOTATION_TOOL_ID,
    [editor]
  )
  return (
    <button
      aria-label={ANNOTATION_TOOL_LABEL}
      aria-pressed={isSelected ? 'true' : 'false'}
      className="tlui-button tlui-button__tool cowart-annotation-toolbar-button"
      data-testid={`tools.${ANNOTATION_TOOL_ID}`}
      data-value={ANNOTATION_TOOL_ID}
      draggable={false}
      onClick={() => {
        unlockGlobalToolLock(editor)
        editor.setCurrentTool(ANNOTATION_TOOL_ID)
      }}
      onTouchStart={(event) => {
        event.preventDefault()
        unlockGlobalToolLock(editor)
        editor.setCurrentTool(ANNOTATION_TOOL_ID)
      }}
      title={ANNOTATION_TOOL_LABEL}
      type="button"
    >
      {annotationToolIcon}
      <span className="cowart-annotation-toolbar-label" draggable={false}>
        {ANNOTATION_TOOL_LABEL}
      </span>
    </button>
  )
}
function CowartToolbarDivider() {
  return <div aria-orientation="vertical" className="cowart-toolbar-divider" role="separator" />
}
function CowartToolbar(props) {
  return (
    <CowartDraggableToolbar {...props} maxItems={12}>
      <CowartAnnotationToolbarItem />
      <CowartToolbarDivider />
      <SelectToolbarItem />
      <HandToolbarItem />
      <CowartToolbarItem toolId={AI_IMAGE_TOOL_ID} />
      <CowartToolbarItem toolId={AI_DRAFT_TOOL_ID} />
      <CowartToolbarItem toolId={AI_FILM_TOOL_ID} />
      <CowartToolbarItem toolId={AI_SLIDES_TOOL_ID} />
      <CowartToolbarDivider />
      <AssetToolbarItem />
      <DrawToolbarItem />
      <EraserToolbarItem />
      <TextToolbarItem />
      <ArrowToolbarItem />
      <NoteToolbarItem />
      <RectangleToolbarItem />
      <EllipseToolbarItem />
      <TriangleToolbarItem />
      <DiamondToolbarItem />
      <HexagonToolbarItem />
      <OvalToolbarItem />
      <RhombusToolbarItem />
      <StarToolbarItem />
      <CloudToolbarItem />
      <HeartToolbarItem />
      <XBoxToolbarItem />
      <CheckBoxToolbarItem />
      <ArrowLeftToolbarItem />
      <ArrowUpToolbarItem />
      <ArrowDownToolbarItem />
      <ArrowRightToolbarItem />
      <LineToolbarItem />
      <HighlightToolbarItem />
      <LaserToolbarItem />
      <FrameToolbarItem />
    </CowartDraggableToolbar>
  )
}
export { CowartToolbarItem, CowartAnnotationToolbarItem, CowartToolbarDivider, CowartToolbar }
