import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

export function workspaceIdentity(directory) {
  return createHash('sha256').update(resolve(directory)).digest('hex')
}
