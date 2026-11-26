import { createCreationTool } from './creation-tool.js'

// Native legacy F-click at (500,350) -> (340,260), 320x180 (2026-11-26).
export function createFrameTool(context) {
  return createCreationTool(context, { id: 'frame', shapeType: 'frame', w: 320, h: 180 })
}
