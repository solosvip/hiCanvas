import { createCreationTool } from './creation-tool.js'
import { aiFramePreset } from './creation-presets.js'

export const createAiImageTool = context => createCreationTool(context, aiFramePreset('ai-image'))
