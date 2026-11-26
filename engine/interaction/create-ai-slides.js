import { createCreationTool } from './creation-tool.js'
import { aiFramePreset } from './creation-presets.js'

export const createAiSlidesTool = context => createCreationTool(context, aiFramePreset('ai-slides'))
