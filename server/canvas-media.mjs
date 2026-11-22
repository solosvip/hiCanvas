import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { decodeReference } from './image-provider.mjs'
import { imageDimensions } from './image-dimensions.mjs'
import { placeMedia, targetFor } from './media-placement.mjs'
import { httpError } from './file-lock.mjs'

export function createCanvasMedia(workspace) {
  async function saveAsset(id, bytes, name) {
    const dir = await workspace.assetsDir(id)
    await mkdir(dir, { recursive: true })
    const fileName = `${randomUUID()}-${basename(name || 'asset').replace(/[^\p{L}\p{N}._-]/gu, '-').slice(-100)}`
    const assetPath = join(dir, fileName)
    await writeFile(assetPath, bytes, { flag: 'wx', mode: 0o600 })
    return { fileName, assetPath, assetUrl: `/c/${id}/assets/${encodeURIComponent(fileName)}` }
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
    const image = decodeReference(args.dataUrl)
    const saved = await saveAsset(id, image.bytes, `reference.${image.extension}`)
    return { ...saved, src: saved.assetUrl, mimeType: image.mimeType }
  }
  async function insertHtml(id, args) {
    if (typeof args.htmlContent !== 'string' || !args.htmlContent.trim() || Buffer.byteLength(args.htmlContent) > 5 * 1024 * 1024) throw httpError('需要非空且小于 5 MB 的 HTML。')
    let inserted, saved
    const transform = async snapshot => {
      const { anchor } = targetFor(snapshot, args)
      saved = args.dryRun ? { assetUrl: '' } : await saveAsset(id, Buffer.from(args.htmlContent), (args.fileName || 'draft.html').replace(/(?:\.html?)?$/, '.html'))
      const film = anchor?.meta?.cowartAiFilmHolder || anchor?.meta?.cowartFilm || args.shapeMeta?.cowartFilm
      const meta = { cowartHtmlDraft: true, cowartHtmlDraftAssetUrl: saved.assetUrl, cowartHtmlDraftContentHash: createHash('sha256').update(args.htmlContent).digest('hex'), ...args.shapeMeta }
      if (film) Object.assign(meta, { cowartFilm: true, cowartFilmDuration: anchor?.meta?.cowartFilmDuration ?? args.shapeMeta?.cowartFilmDuration ?? 15, cowartFilmStyle: anchor?.meta?.cowartFilmStyle ?? args.shapeMeta?.cowartFilmStyle ?? 'product-launch', cowartFilmMuted: anchor?.meta?.cowartFilmMuted ?? false })
      inserted = placeMedia(snapshot, args, { type: 'embed', props: { w: 1024, h: 576, url: `data:text/html;base64,${Buffer.from(args.htmlContent).toString('base64')}` }, meta })
      return snapshot
    }
    if (args.dryRun) {
      const state = await workspace.read(id)
      if (args.expectedRevision !== state.revision) throw httpError('画板版本已变化。', 409, { storage: 'revision-conflict', revision: state.revision })
      await transform(structuredClone(state.snapshot))
      return { ...inserted, dryRun: true, revision: state.revision }
    }
    const result = await workspace.mutate(id, args.expectedRevision, transform)
    return { ...result, ...inserted, ...saved, contentHash: inserted.shapeRecord.meta.cowartHtmlDraftContentHash, snapshot: undefined }
  }
  async function insertImage(id, args) {
    const image = args.dataUrl ? decodeReference(args.dataUrl) : await readAsset(id, args.assetUrl)
    if (!image.mimeType.startsWith('image/')) throw httpError('需要图片资源。')
    const { w, h } = imageDimensions(image.bytes)
    let inserted, saved
    const result = await workspace.mutate(id, args.expectedRevision, async snapshot => {
      targetFor(snapshot, args)
      saved = args.assetUrl ? { assetUrl: args.assetUrl } : await saveAsset(id, image.bytes, args.fileName || `image.${image.extension}`)
      const assetId = `asset:${randomUUID()}`
      snapshot.store[assetId] = { id: assetId, typeName: 'asset', type: 'image', props: { name: saved.assetUrl.split('/').at(-1), src: saved.assetUrl, w, h, mimeType: image.mimeType, isAnimated: false }, meta: {} }
      const width = Math.min(w, 512)
      inserted = placeMedia(snapshot, args, { type: 'image', props: { assetId, w: width, h: h / w * width }, meta: args.shapeMeta })
      return snapshot
    })
    return { ...result, ...inserted, ...saved, snapshot: undefined }
  }
  return { saveAsset, readAsset, reference, insertHtml, insertImage }
}
