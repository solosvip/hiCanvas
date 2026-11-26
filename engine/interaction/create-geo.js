import { createCreationTool } from './creation-tool.js'
import { geometryPreset } from './creation-presets.js'

// Legacy native click observation (2026-11-26): centered 200x200 rectangle;
// the default document appearance is black, unfilled, hand-drawn medium ink.
export function createGeoTool(context) {
  return createCreationTool(context, () => geometryPreset(context.read().creation.geo))
}
