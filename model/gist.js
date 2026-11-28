import { normalizeHttpUrl } from './http-url.js'

// These are local input budgets, not a promise that a remote Gist exists.
export function normalizeGistId(value) {
  return typeof value === 'string' && /^[a-f\d]{1,64}$/i.test(value) ? value.toLowerCase() : null
}

export function parseGistUrl(value) {
  const normalized = normalizeHttpUrl(value)
  if (!normalized) return null
  const url = new URL(normalized)
  if (url.protocol !== 'https:' || url.hostname !== 'gist.github.com') return null
  // Inspect the authored path before URL removes dot segments or escapes.
  const path = value.trim().match(/^https:\/\/[^/?#]+(\/[^?#]*)?(?:[?#]|$)/i)?.[1] || ''
  const match = path.match(/^\/(?:(?<owner>[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?)\/)?(?<id>[a-f\d]{1,64})\/?$/i)
  if (!match) return null
  const gistId = normalizeGistId(match.groups.id)
  return Object.freeze({ gistId, url: `https://gist.github.com/${match.groups.owner ? match.groups.owner + '/' : ''}${gistId}` })
}
