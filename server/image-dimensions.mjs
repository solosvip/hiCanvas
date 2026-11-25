import { httpError } from './file-lock.mjs'

export function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return size(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) return size(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
      offset += length
    }
  }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16)
    if (type === 'VP8X') return size(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1)
    if (type === 'VP8 ') return size(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff)
    if (type === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    }
  }
  throw httpError('图片已保存，但无法读取尺寸。请使用结果地址找回，未重新请求生图。', 422)
}
function size(w, h) {
  if (!w || !h || w > 100000 || h > 100000) throw httpError('图片尺寸无效。', 422)
  return { w, h }
}
