import { crc32 } from 'node:zlib'
import { httpError } from './file-lock.mjs'
import { imageDimensions } from './image-dimensions.mjs'

const limit = 20 * 1024 * 1024
const fail = () => { throw httpError('图片损坏、格式不符或尺寸超限。') }
function size(w, h) {
  if (![w, h].every(n => Number.isInteger(n) && n > 0 && n <= 16384) || w * h > 64 * 1024 * 1024) fail()
  return { w, h }
}
function png(bytes) {
  let offset = 8, dimensions, animated = false, pixels = false, ended = false, chunks = 0
  while (offset + 12 <= bytes.length && ++chunks <= 10000) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length, kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail()
    if (offset === 8 && (kind !== 'IHDR' || length !== 13)) fail()
    if (kind === 'IHDR') { if (dimensions || length !== 13) fail(); dimensions = size(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)) }
    if (kind === 'acTL') { if (length !== 8 || bytes.readUInt32BE(offset + 8) < 1 || bytes.readUInt32BE(offset + 8) > 1000) fail(); animated = true }
    if (kind === 'IDAT') pixels = true
    offset = end
    if (kind === 'IEND') { if (length !== 0) fail(); ended = true; break }
  }
  if (!dimensions || !pixels || !ended) fail()
  return { ...dimensions, mimeType: animated ? 'image/apng' : 'image/png', isAnimated: animated, extension: animated ? 'apng' : 'png' }
}
function gif(bytes) {
  if (bytes.length < 14) fail()
  const dimensions = size(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
  let offset = 13 + (bytes[10] & 128 ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0), frames = 0, blocks = 0
  function subblocks() {
    while (offset < bytes.length) { const n = bytes[offset++]; if (!n) return; offset += n; if (offset > bytes.length) fail() }
    fail()
  }
  while (offset < bytes.length && ++blocks <= 10000) {
    const tag = bytes[offset++]
    if (tag === 59) { if (!frames) fail(); return { ...dimensions, mimeType: 'image/gif', extension: 'gif', isAnimated: frames > 1 } }
    if (tag === 33) { offset++; subblocks() }
    else if (tag === 44) {
      if (offset + 9 > bytes.length || ++frames > 1000) fail()
      size(bytes.readUInt16LE(offset + 4), bytes.readUInt16LE(offset + 6))
      const flags = bytes[offset + 8]; offset += 9 + (flags & 128 ? 3 * (2 ** ((flags & 7) + 1)) : 0)
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 12) fail()
      offset++; subblocks()
    } else fail()
  }
  fail()
}
function webp(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) fail()
  let offset = 12, dimensions, animated = false, pixels = false, chunks = 0
  while (offset + 8 <= bytes.length && ++chunks <= 10000) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), data = offset + 8, end = data + length
    if (end + (length & 1) > bytes.length) fail()
    if (kind === 'VP8X') { if (length !== 10) fail(); dimensions = size(bytes.readUIntLE(data + 4, 3) + 1, bytes.readUIntLE(data + 7, 3) + 1); animated = Boolean(bytes[data] & 2) }
    if (kind === 'VP8 ' || kind === 'VP8L') {
      if (kind === 'VP8 ' && (length < 10 || !bytes.subarray(data + 3, data + 6).equals(Buffer.from([157, 1, 42])))) fail()
      if (kind === 'VP8L' && (length < 5 || bytes[data] !== 47)) fail()
      if (!dimensions) {
        const bits = kind === 'VP8L' && bytes.readUInt32LE(data + 1)
        dimensions = kind === 'VP8L' ? size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1) : size(bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff)
      }
      pixels = true
    }
    if (kind === 'ANMF') { if (length < 16) fail(); pixels = true }
    offset = end + (length & 1)
  }
  if (offset !== bytes.length || !dimensions || !pixels) fail()
  return { ...dimensions, mimeType: 'image/webp', extension: 'webp', isAnimated: animated }
}
function avif(bytes) {
  let count = 0, dimensions, brand = false, animated = false, meta = false, pixels = false
  function boxes(start, end, depth = 0) {
    if (depth > 12) fail()
    while (start < end) {
      if (start + 8 > end || ++count > 2048) fail()
      let length = bytes.readUInt32BE(start), header = 8
      if (length === 1) { if (start + 16 > end) fail(); length = Number(bytes.readBigUInt64BE(start + 8)); header = 16 }
      if (length === 0) length = end - start
      if (!Number.isSafeInteger(length) || length < header || start + length > end) fail()
      const kind = bytes.toString('ascii', start + 4, start + 8), data = start + header, finish = start + length
      if (kind === 'ftyp' && depth === 0) {
        if (length < header + 8 || (length - header) % 4) fail()
        for (let p = data; p + 4 <= finish; p += 4) {
          if (p === data + 4) continue
          const value = bytes.toString('ascii', p, p + 4)
          if (value === 'avif' || value === 'avis') brand = true
          if (value === 'avis') animated = true
        }
      }
      if (kind === 'ispe') { if (length !== header + 12) fail(); const current = size(bytes.readUInt32BE(data + 4), bytes.readUInt32BE(data + 8)); dimensions ||= current }
      if (kind === 'meta') { if (length < header + 4) fail(); meta = true; boxes(data + 4, finish, depth + 1) }
      if (kind === 'iprp' || kind === 'ipco') boxes(data, finish, depth + 1)
      if (kind === 'mdat' && finish > data) pixels = true
      start = finish
    }
  }
  boxes(0, bytes.length)
  if (!brand || !meta || !pixels || !dimensions) fail()
  return { ...dimensions, mimeType: 'image/avif', extension: 'avif', isAnimated: animated }
}

// File import has its own contract. Generation reference decoding remains the
// existing PNG/JPEG/WebP entry. This checks bounded containers, not codecs;
// the host must also successfully decode pixels before creating any shapes.
export function decodeImageUpload(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|apng|avif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl || '')
  if (!match || match[2].length % 4 || match[2].length > Math.ceil(limit / 3) * 4) throw httpError('图片只支持 PNG、JPEG、WebP、GIF、APNG、AVIF，且不超过 20 MB。')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > limit) throw httpError('图片需要非空且不超过 20 MB。')
  let info
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) info = png(bytes)
  else if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) info = gif(bytes)
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') info = webp(bytes)
  else if (bytes.toString('ascii', 4, 8) === 'ftyp') info = avif(bytes)
  else if (bytes[0] === 255 && bytes[1] === 216) {
    // Motion photos append video after the JPEG; dimensions do not require EOI
    // at the file end. Pixel decoding remains the host's responsibility.
    try { const { w, h } = imageDimensions(bytes); info = { ...size(w, h), mimeType: 'image/jpeg', extension: 'jpg', isAnimated: false } } catch { fail() }
  } else fail()
  if (match[1] !== info.mimeType && !(match[1] === 'image/png' && info.mimeType === 'image/apng')) fail()
  return { bytes, ...info }
}
