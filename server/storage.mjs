import { isCanvasSnapshot, sanitizeCanvasSnapshot } from '../model/index.js'
// Cowart 38bdafef 的本地存储实现；MIT，© 2026 Twox。
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
const projectDir = resolve(process.env.HICANVAS_PROJECT_DIR ?? process.env.COWART_PROJECT_DIR ?? join(homedir(), 'Documents', 'hiCanvas'))
const defaultCanvasDir = resolve(process.env.HICANVAS_CANVAS_DIR ?? process.env.COWART_CANVAS_DIR ?? join(projectDir, 'canvas'))
function createCanvasStorage(canvasDir = defaultCanvasDir) {
const canvasFile = join(canvasDir, 'cowart-canvas.json')
const selectionFile = join(canvasDir, 'cowart-selection.json')
const viewStateFile = join(canvasDir, 'cowart-view-state.json')
const canvasPagesDir = join(canvasDir, 'pages')
const canvasAssetsDir = join(canvasDir, 'assets')
const pagesManifestFile = join(canvasPagesDir, 'manifest.json')
const canvasFileName = 'cowart-canvas.json'
const pageIdPrefix = 'page:'
const globalAssetsRoute = '/assets/'
const pageAssetsRoute = '/page-assets/'
const mimeTypes = new Map([
  ['.apng', 'image/apng'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8']
])
async function sanitizeCanvasSnapshotForServer(snapshot) {
  return sanitizeCanvasSnapshot(snapshot)
}
function isSafeChildPath(parent, child) {
  const pathToChild = relative(parent, child)
  return pathToChild && !pathToChild.startsWith('..') && !pathToChild.includes(`..${sep}`)
}
function pageDirName(pageId) {
  return encodeURIComponent(pageId.replace(pageIdPrefix, ''))
}
function pageFilePath(pageId) {
  return join(canvasPagesDir, pageDirName(pageId), canvasFileName)
}
function pageAssetsDir(pageId) {
  return join(canvasPagesDir, pageDirName(pageId), 'assets')
}
function pageAssetUrl(pageId, fileName) {
  return `${pageAssetsRoute}${pageDirName(pageId)}/${encodeURIComponent(fileName)}`
}
function getPageRecords(snapshot) {
  return Object.values(snapshot.store)
    .filter((record) => record?.typeName === 'page')
    .sort((a, b) => String(a.index ?? '').localeCompare(String(b.index ?? '')))
}
function getAssetIdsForShapes(shapes) {
  return new Set(
    shapes
      .map((shape) => shape?.props?.assetId)
      .filter((assetId) => typeof assetId === 'string')
  )
}
function getShapeRecordsForPage(snapshot, pageId) {
  const shapesByParent = new Map()
  for (const record of Object.values(snapshot.store)) {
    if (record?.typeName !== 'shape') continue
    const siblings = shapesByParent.get(record.parentId) ?? []
    siblings.push(record)
    shapesByParent.set(record.parentId, siblings)
  }
  const shapes = []
  const queue = [...(shapesByParent.get(pageId) ?? [])]
  while (queue.length > 0) {
    const shape = queue.shift()
    shapes.push(shape)
    queue.push(...(shapesByParent.get(shape.id) ?? []))
  }
  return shapes
}
function isBindingForShapes(record, shapeIds) {
  if (record?.typeName !== 'binding') return false
  const fromId = record.fromId ?? record.props?.fromId
  const toId = record.toId ?? record.props?.toId
  return shapeIds.has(fromId) || shapeIds.has(toId)
}
function snapshotForPage(snapshot, page) {
  const pageId = page.id
  const pageShapes = getShapeRecordsForPage(snapshot, pageId)
  const shapeIds = new Set(pageShapes.map((shape) => shape.id))
  const assetIds = getAssetIdsForShapes(pageShapes)
  const store = {}
  for (const record of Object.values(snapshot.store)) {
    if (!record?.id) continue
    if (record.typeName === 'page') {
      if (record.id === pageId) store[record.id] = record
      continue
    }
    if (record.typeName === 'shape') {
      if (shapeIds.has(record.id)) store[record.id] = record
      continue
    }
    if (record.typeName === 'asset') {
      if (assetIds.has(record.id)) store[record.id] = record
      continue
    }
    if (record.typeName === 'binding') {
      if (isBindingForShapes(record, shapeIds)) store[record.id] = record
      continue
    }
    store[record.id] = record
  }
  return {
    schema: snapshot.schema,
    store
  }
}
function extensionFromMimeType(mimeType) {
  switch (mimeType) {
    case 'image/apng':
      return '.apng'
    case 'image/avif':
      return '.avif'
    case 'image/gif':
      return '.gif'
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/svg+xml':
      return '.svg'
    case 'image/webp':
      return '.webp'
    case 'text/html':
      return '.html'
    default:
      return '.bin'
  }
}
function sanitizeAssetFileName(name, fallbackName, mimeType) {
  const rawName = basename(String(name || fallbackName || 'asset'))
  const extension = extname(rawName) || extensionFromMimeType(mimeType)
  const baseName = rawName
    .slice(0, rawName.length - extname(rawName).length)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${baseName || 'asset'}${extension}`
}
function parseDataUrl(src) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(src)
  if (!match) return null
  const mimeType = match[1] || 'application/octet-stream'
  const encoded = match[2]
  const isBase64 = /^data:[^,]*;base64,/i.test(src)
  const buffer = isBase64 ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded))
  return { buffer, mimeType }
}
function localAssetFilePathFromUrl(src) {
  let route = null
  let baseDir = null
  if (src.startsWith(globalAssetsRoute)) {
    route = globalAssetsRoute
    baseDir = canvasAssetsDir
  } else if (src.startsWith(pageAssetsRoute)) {
    const parts = src.slice(pageAssetsRoute.length).split('/')
    const pageDir = parts.shift() ?? ''
    const decoded = decodeURIComponent(pageDir)
    if (!decoded || decoded === '.' || decoded === '..' || /[\\/]/.test(decoded) || parts.length === 0) return null
    const filePath = resolve(join(canvasPagesDir, pageDir, 'assets'), ...parts.map(decodeURIComponent))
    return isSafeChildPath(join(canvasPagesDir, pageDir, 'assets'), filePath) ? filePath : null
  } else {
    return null
  }
  const requestedPath = decodeURIComponent(src.slice(route.length))
  const filePath = resolve(baseDir, requestedPath)
  return isSafeChildPath(baseDir, filePath) ? filePath : null
}
async function localizePageAsset(asset, pageId) {
  const src = asset?.props?.src
  if (!src || typeof src !== 'string' || /^https?:\/\//.test(src)) return asset
  const currentPagePrefix = `${pageAssetsRoute}${pageDirName(pageId)}/`
  if (src.startsWith(currentPagePrefix)) return asset
  const localizedAsset = structuredClone(asset)
  const dataUrl = src.startsWith('data:') ? parseDataUrl(src) : null
  const sourceFilePath = dataUrl ? null : localAssetFilePathFromUrl(src)
  if (!dataUrl && !sourceFilePath) return localizedAsset
  const fileName = sanitizeAssetFileName(
    dataUrl ? null : localizedAsset.props.name,
    sourceFilePath ? basename(sourceFilePath) : localizedAsset.id.replace(':', '-'),
    dataUrl?.mimeType ?? localizedAsset.props.mimeType
  )
  const destinationDir = pageAssetsDir(pageId)
  const destinationPath = join(destinationDir, fileName)
  await mkdir(destinationDir, { recursive: true })
  if (dataUrl) {
    await writeFile(destinationPath, dataUrl.buffer)
    localizedAsset.props.mimeType = localizedAsset.props.mimeType ?? dataUrl.mimeType
    localizedAsset.props.fileSize = dataUrl.buffer.length
  } else if (resolve(sourceFilePath) !== resolve(destinationPath)) {
    await copyFile(sourceFilePath, destinationPath)
    localizedAsset.props.fileSize = (await stat(destinationPath)).size
  }
  localizedAsset.props.name = fileName
  localizedAsset.props.src = pageAssetUrl(pageId, fileName)
  return localizedAsset
}
async function persistHtmlDraftAsset(record, pageId) {
  if (
    record?.typeName !== 'shape' ||
    record.type !== 'embed' ||
    record.meta?.cowartHtmlDraft !== true ||
    typeof record.props?.url !== 'string'
  ) {
    return record
  }
  const assetUrl = record.meta?.cowartHtmlDraftAssetUrl
  const expectedPrefix = `${pageAssetsRoute}${pageDirName(pageId)}/`
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith(expectedPrefix)) return record
  const parsed = record.props.url.startsWith('data:') ? parseDataUrl(record.props.url) : null
  if (!parsed || parsed.mimeType !== 'text/html') return record
  const assetPath = localAssetFilePathFromUrl(assetUrl)
  if (!assetPath) return record
  await mkdir(dirname(assetPath), { recursive: true })
  await writeFile(assetPath, parsed.buffer)
  return record
}
async function localizePageAssets(pageSnapshot, pageId) {
  const entries = await Promise.all(
    Object.entries(pageSnapshot.store).map(async ([id, record]) => {
      if (record?.typeName === 'asset') return [id, await localizePageAsset(record, pageId)]
      return [id, await persistHtmlDraftAsset(record, pageId)]
    })
  )
  return {
    ...pageSnapshot,
    store: Object.fromEntries(entries)
  }
}
async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}
async function readPageSnapshots() {
  let files
  try {
    const manifest = await readJsonFile(pagesManifestFile)
    if (!Array.isArray(manifest.pages) || manifest.pages.some(page => typeof page.id !== 'string' || !page.id.startsWith(pageIdPrefix))) {
      throw new Error('画板页面索引无效，已停止读取以保护原有文件。')
    }
    files = manifest.pages.map(page => pageFilePath(page.id))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    // 兼容尚未建立索引的旧 Cowart 文件；索引存在时只读取仍在列表中的页。
    try {
      const entries = await readdir(canvasPagesDir, { withFileTypes: true })
      files = entries.filter(entry => entry.isDirectory()).map(entry => join(canvasPagesDir, entry.name, canvasFileName))
    } catch (directoryError) {
      if (directoryError.code === 'ENOENT') return []
      throw directoryError
    }
  }
  const snapshots = []
  for (const filePath of files) {
    const snapshot = await readJsonFile(filePath)
    if (!isCanvasSnapshot(snapshot)) throw new Error('页面文件不是有效画板，已停止读取。')
    snapshots.push({ filePath, snapshot })
  }
  return snapshots
}
async function loadCanvasSnapshot() {
  const pageSnapshots = await readPageSnapshots()
  if (pageSnapshots.length > 0) {
    const [{ snapshot: firstSnapshot }] = pageSnapshots
    const mergedSnapshot = {
      schema: firstSnapshot.schema,
      store: Object.fromEntries(pageSnapshots.flatMap(({ snapshot }) => Object.entries(snapshot.store)))
    }
    return {
      snapshot: mergedSnapshot,
      path: canvasPagesDir,
      storage: 'per-page'
    }
  }
  try {
    return {
      snapshot: await readJsonFile(canvasFile),
      path: canvasFile,
      storage: 'legacy-single-file'
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { snapshot: null, path: canvasPagesDir, storage: 'empty' }
    }
    throw error
  }
}
async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`)
  await rename(tempFile, filePath)
}
async function saveCanvasSnapshot(snapshot) {
  const pages = getPageRecords(snapshot)
  if (pages.length === 0) {
    await writeJsonAtomic(canvasFile, snapshot)
    return { storage: 'legacy-single-file', paths: [canvasFile] }
  }
  const paths = []
  for (const page of pages) {
    const filePath = pageFilePath(page.id)
    const pageSnapshot = await localizePageAssets(snapshotForPage(snapshot, page), page.id)
    await writeJsonAtomic(filePath, pageSnapshot)
    paths.push(filePath)
  }
  const manifest = {
    version: 1,
    source: 'cowart',
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      index: page.index,
      path: relative(canvasDir, pageFilePath(page.id))
    }))
  }
  await writeJsonAtomic(pagesManifestFile, manifest)
  return { storage: 'per-page', paths }
}
async function serveCanvasAsset(req, res, next) {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (!url.pathname.startsWith(globalAssetsRoute) && !url.pathname.startsWith(pageAssetsRoute)) {
    next()
    return
  }
  const filePath = localAssetFilePathFromUrl(url.pathname)
  if (!filePath) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', mimeTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream')
    res.setHeader('content-length', String(fileStat.size))
    res.setHeader('cache-control', 'no-cache')
    createReadStream(filePath).pipe(res)
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    next(error)
  }
}
return { canvasDir, selectionFile, viewStateFile, writeJsonAtomic, readJsonFile, loadCanvasSnapshot, saveCanvasSnapshot, sanitizeCanvasSnapshotForServer, serveCanvasAsset }
}
const { canvasDir, selectionFile, viewStateFile, writeJsonAtomic, readJsonFile, loadCanvasSnapshot, saveCanvasSnapshot, sanitizeCanvasSnapshotForServer, serveCanvasAsset } = createCanvasStorage()
export { createCanvasStorage, canvasDir, selectionFile, viewStateFile, writeJsonAtomic, readJsonFile, loadCanvasSnapshot, saveCanvasSnapshot, sanitizeCanvasSnapshotForServer, serveCanvasAsset }
