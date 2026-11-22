// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { CowartStylePanel } from './StylePanel.jsx'
import { CowartSelectionToolbar } from './CowartSelectionToolbar.jsx'
import { CowartToolbar } from './Toolbar.jsx'
import { CowartSlidesPresentationOverlay } from './SlidesPresentation.jsx'
import { DefaultMainMenu } from 'tldraw'
import { CowartAiImageGenerationPanel } from './ImageGenerationPanel.jsx'
import { CowartAiDraftGenerationPanel } from './DraftGenerationPanel.jsx'
import { CowartAiSlidesGenerationPanel } from './SlidesGenerationPanel.jsx'
import { ImageResults } from '../conversations/ImageResults.jsx'
import { ConversationMenu } from '../conversations/ConversationMenu.jsx'
import { SettingsPanel } from '../image-models/ModelSettings.jsx'

function CowartMainMenu() {
  return <>
    <DefaultMainMenu />
    <SettingsPanel />
    <ConversationMenu />
    <ImageResults />
  </>
}

const cowartComponents = {
  Toolbar: CowartToolbar,
  MainMenu: CowartMainMenu,
  SharePanel: null,
  ImageToolbar: CowartSelectionToolbar,
  InFrontOfTheCanvas: CowartCanvasOverlay,
  StylePanel: CowartStylePanel
}
function CowartCanvasOverlay() {
  return (
    <>
      <CowartAiImageGenerationPanel />
      <CowartAiDraftGenerationPanel />
      <CowartAiSlidesGenerationPanel />
      <CowartSlidesPresentationOverlay />
    </>
  )
}
export { cowartComponents, CowartCanvasOverlay }
