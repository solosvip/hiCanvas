import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { decodeReference } from './image-provider.mjs'
import { imageDimensions } from './image-dimensions.mjs'
import { executeCanvasCommands, getMediaTarget } from '../engine/index.js'
import { httpError } from './file-lock.mjs'
import { decodeVideoUpload } from './video-upload.mjs'
import { decodeImageUpload } from './image-upload.mjs'
import { decodeSvgUpload } from './svg-sanitize.mjs'

export function createCanvasMedia(workspace) {
  async function assetDestination(id, name) {
    const dir = await workspace.assetsDir(id)
    const fileName = `${randomUUID()}-${basename(name || 'asset').replace(/[^\p{L}\p{N}._-]/gu, '-').slice(-100)}`
    const assetPath = join(dir, fileName)
    return { fileName, assetPath, assetUrl: `/c/${id}/assets/${encodeURIComponent(fileName)}` }
  }
  async function saveAsset(id, bytes, name) {
    const saved = await assetDestination(id, name)
    await mkdir(await workspace.assetsDir(id), { recursive: true })
    await writeFile(saved.assetPath, bytes, { flag: 'wx', mode: 0o600 })
    return saved
  }
  async function readAsset(id, assetUrl) {
    await workspace.requireConversation(id)
    const prefix = `/c/${id}/`
    if (typeof assetUrl !== 'string' || !assetUrl.startsWith(prefix)) throw httpError('只能读取当前对话的本机资源。', 403)
    const parts = assetUrl.slice(prefix.length).split('/').map(part => decodeURIComponent(part))
    if (!((parts[0] === 'assets' && parts.length === 2) || (parts[0] === 'page-assets' && parts.length === 3))) throw httpError('资源路径无效。')
    if (parts.some(part => !part || ['.', '..'].includes(part) || /[\\/]/.test(part))) throw httpError('资源路径无效。')
    const name = parts.at(-1)
    const directory = parts[0] === 'assets' ? await workspace.assetsDir(id) : join((await workspace.storageFor(id)).canvasDir, 'pages', encodeURIComponent(parts[1]), 'assets')
    if (!name || basename(name) !== name || /[\\/]/.test(name) || name === '.' || name === '..') throw httpError('资源路径无效。')
    const bytes = await readFile(join(directory, name))
    if (bytes.length > 20 * 1024 * 1024) throw httpError('资源超过 20 MB。')
    const ext = name.split('.').at(-1).toLowerCase()
    const mimeType = ({ html: 'text/html', htm: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' })[ext] || 'application/octet-stream'
    return { bytes, mimeType, assetPath: join(directory, name) }
  }
  async function reference(id, args) {
    if (args.purpose !== undefined && !['file-import', 'file-import-prepare'].includes(args.purpose)) throw httpError('未知资源上传用途。')
    if (args.purpose === 'file-import-prepare') {
      const image = decodeSvgUpload(args.dataUrl)
      return { dataUrl: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`, mimeType: image.mimeType, isAnimated: false, warnings: image.warnings }
    }
    const image = args.purpose === 'file-import' ? typeof args.dataUrl === 'string' && args.dataUrl.startsWith('data:image/svg+xml;') ? decodeSvgUpload(args.dataUrl) : decodeImageUpload(args.dataUrl) : typeof args.dataUrl === 'string' && args.dataUrl.startsWith('data:video/') ? decodeVideoUpload(args.dataUrl) : decodeReference(args.dataUrl)
    const saved = await saveAsset(id, image.bytes, `reference.${image.extension}`)
    return { ...saved, src: saved.assetUrl, mimeType: image.mimeType, ...(args.purpose === 'file-import' && { w: image.w, h: image.h, isAnimated: image.isAnimated, ...(image.warnings && { warnings: image.warnings }) }) }
  }
  async function insertHtml(id, args, actor = 'http') {
    if (typeof args.htmlContent !== 'string' || !args.htmlContent.trim() || Buffer.byteLength(args.htmlContent) > 5 * 1024 * 1024) throw httpError('需要非空且小于 5 MB 的 HTML。')
    const result = await commitMedia(id, args, actor, async () => {
      const saved = args.dryRun ? { assetUrl: '' } : await saveAsset(id, Buffer.from(args.htmlContent), (args.fileName || 'draft.html').replace(/(?:\.html?)?$/, '.html'))
      const html = { assetUrl: saved.assetUrl, contentHash: createHash('sha256').update(args.htmlContent).digest('hex'), url: `data:text/html;base64,${Buffer.from(args.htmlContent).toString('base64')}` }
      return { saved, command: { type: 'insert_html', args, html } }
    })
    return result.dryRun ? result : { ...result, contentHash: result.shapeRecord.meta.cowartHtmlDraftContentHash }
  }
  async function insertImage(id, args, actor = 'http') {
    const image = args.dataUrl ? decodeReference(args.dataUrl) : await readAsset(id, args.assetUrl)
    if (!image.mimeType.startsWith('image/')) throw httpError('需要图片资源。')
    const { w, h } = imageDimensions(image.bytes)
    return commitMedia(id, args, actor, async () => {
      const saved = args.assetUrl ? { assetUrl: args.assetUrl } : args.dryRun ? { assetUrl: '' } : await saveAsset(id, image.bytes, args.fileName || `image.${image.extension}`)
      return { saved, command: { type: 'insert_image', args, image: { src: saved.assetUrl, name: saved.assetUrl.split('/').at(-1), w, h, mimeType: image.mimeType } } }
    })
  }
  async function commitMedia(id, args, actor, prepare) {
    let saved
    const createCommands = async snapshot => {
      getMediaTarget(snapshot, args)
      const prepared = await prepare()
      saved = prepared.saved
      return [prepared.command]
    }
    if (args.dryRun) {
      const state = await workspace.read(id)
      if (args.expectedRevision !== state.revision) throw httpError('画板版本已变化。', 409, { storage: 'revision-conflict', revision: state.revision })
      const edit = executeCanvasCommands(state.snapshot, await createCommands(state.snapshot))
      return { ...edit.results[0], dryRun: true, actor, revision: state.revision }
    }
    const { changes: _changes, results, ...result } = await workspace.submitCommands(id, args.expectedRevision, actor, createCommands)
    return { ...result, ...results[0], ...saved, snapshot: undefined }
  }
  return { assetDestination, saveAsset, readAsset, reference, insertHtml, insertImage }
}
