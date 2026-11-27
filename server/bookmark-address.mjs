import { isIP } from 'node:net'

export class BookmarkError extends Error {
  constructor(code, status = 422) {
    super(code)
    this.name = 'BookmarkError'
    this.code = code
    this.status = status
  }
}

function ipv4Bits(ip) {
  return ip.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n)
}

function ipv6Bits(ip) {
  const [left, right] = ip.split('::')
  const a = left ? left.split(':') : []
  const b = right ? right.split(':') : []
  const parts = right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b]
  return parts.reduce((n, part) => (n << 16n) | BigInt(`0x${part}`), 0n)
}

function prefix(ip, bits, length, width) {
  return (ip >> BigInt(width - length)) === (bits >> BigInt(width - length))
}

// Conservative snapshot of ALL IANA special-purpose entries, including ones
// marked globally reachable. Review against both IANA registries, 2025-10-09.
// No runtime registry fetch and no setting/environment escape hatch.
const v4Special = [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24],
  ['192.31.196.0',24], ['192.52.193.0',24], ['192.88.99.0',24], ['192.168.0.0',16],
  ['192.175.48.0',24], ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24],
  ['224.0.0.0',4], ['240.0.0.0',4],
].map(([ip, length]) => [ipv4Bits(ip), length])
const v6Special = [
  ['2001::',23], ['2001:db8::',32], ['2002::',16], ['2620:4f:8000::',48], ['3fff::',20],
].map(([ip, length]) => [ipv6Bits(ip), length])

export function publicAddress(ip) {
  if (typeof ip !== 'string') return false
  const family = isIP(ip)
  if (family === 4) return !v4Special.some(([bits, length]) => prefix(ipv4Bits(ip), bits, length, 32))
  // Only native global-unicast IPv6 is eligible. Dotted tails and all mapped,
  // translation, local, multicast and unallocated families are refused.
  if (family !== 6 || ip.includes('.')) return false
  const bits = ipv6Bits(ip)
  return prefix(bits, ipv6Bits('2000::'), 3, 128) && !v6Special.some(([base, length]) => prefix(bits, base, length, 128))
}

export function bookmarkTarget(value) {
  const invalid = () => { throw new BookmarkError('invalid_url', 400) }
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 8192 || /[\s\\\u0000-\u001f\u007f-\u009f]/u.test(value)) invalid()
  const authority = value.match(/^https?:\/\/([^/?#]+)/i)?.[1]
  if (!authority || authority.includes('%') || authority.includes('@')) invalid()
  let url
  try { url = new URL(value) } catch { invalid() }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) invalid()
  url.hash = ''
  let host = url.hostname.toLowerCase()
  const rawHost = authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1) : authority.replace(/:\d+$/, '')
  const ip = host.startsWith('[') ? host.slice(1, -1) : host
  if (isIP(ip)) {
    if (isIP(ip) === 4 && rawHost !== ip) invalid()
    if (!publicAddress(ip)) throw new BookmarkError('target_not_public')
  } else {
    host = host.replace(/\.$/, '')
    if (!host.includes('.') || host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) invalid()
    if (/(?:^|\.)(?:localhost|local|internal|home|arpa|test|invalid|example|onion)$/.test(host)) throw new BookmarkError('target_not_public')
    url.hostname = host
  }
  return url
}

export function selectBookmarkAddress(answers) {
  if (!Array.isArray(answers) || !answers.length || answers.length > 16 || answers.some(item =>
    !item || isIP(item.address) !== item.family || !publicAddress(item.address))) throw new BookmarkError('target_not_public')
  return { address: answers[0].address, family: answers[0].family }
}

export function bookmarkReference(value, base) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 8192 || /[\s\\\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new BookmarkError('invalid_url',400)
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return bookmarkTarget(value)
  if (value.startsWith('//')) return bookmarkTarget(new URL(base).protocol + value)
  return bookmarkTarget(new URL(value,base).href)
}
