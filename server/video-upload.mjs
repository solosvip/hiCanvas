import { httpError } from './file-lock.mjs'
import { maxVideoBytes } from '../engine/index.js'
export { maxVideoBytes } from '../engine/index.js'

// Base64 plus JSON must fit the existing 50 MiB HTTP body limit.
export function decodeVideoUpload(dataUrl) {
  const match = /^data:(video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl || '')
  if (!match || match[2].length % 4 || match[2].length > Math.ceil(maxVideoBytes / 3) * 4) throw httpError('视频需要 MP4、WebM 或 MOV，且不能超过 37 MB。')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > maxVideoBytes) throw httpError('视频不能超过 37 MB。')
  const ftyp = bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length
  const quicktime = ftyp && bytes.toString('ascii', 8, 12) === 'qt  '
  const mimeType = bytes.length >= 5 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? 'video/webm' : ftyp ? quicktime ? 'video/quicktime' : 'video/mp4' : null
  if (!mimeType || mimeType !== match[1]) throw httpError('视频文件头与声明类型不符。')
  return { bytes, mimeType, extension: mimeType === 'video/webm' ? 'webm' : quicktime ? 'mov' : 'mp4' }
}
