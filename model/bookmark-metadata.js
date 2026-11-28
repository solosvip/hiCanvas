import { normalizeHttpUrl } from './http-url.js'

export function cleanBookmarkText(value, limit) {
  if (typeof value !== 'string' || value.length > 16384) throw new TypeError('Invalid bookmark text')
  return Array.from(value.toWellFormed().normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/gu, ' ').trim()).slice(0, limit).join('')
}

// Pure data contract shared by fetching and the future write command. A link
// here carries no network permission; public-address checks belong to the host.
export function normalizeBookmarkMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== 3 || !['title','description','url'].every(key => Object.hasOwn(value,key))) throw new TypeError('Invalid bookmark metadata')
  const normalized = normalizeHttpUrl(value.url)
  if (!normalized) throw new TypeError('Invalid bookmark URL')
  const url = new URL(normalized)
  url.hash = ''
  return { title:cleanBookmarkText(value.title,300), description:cleanBookmarkText(value.description,1000), url:url.href }
}
