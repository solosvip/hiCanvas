import { createCreationTool } from './creation-tool.js'
import { aiFramePreset } from './creation-presets.js'

export const createAiFilmTool = context => createCreationTool(context, aiFramePreset('ai-film'))
