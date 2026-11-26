import { createCreationTool } from './creation-tool.js'
import { aiFramePreset } from './creation-presets.js'

export const createAiDraftTool = context => createCreationTool(context, aiFramePreset('ai-draft'))
