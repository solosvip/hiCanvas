import { join } from 'node:path'
import { homedir } from 'node:os'

export function imageSettingsDirectory(env = process.env) {
  return env.HICANVAS_SETTINGS_DIR || join(env.HICANVAS_PROJECT_DIR || join(homedir(), 'Documents', 'hiCanvas'), 'settings')
}
