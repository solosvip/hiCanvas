import { mkdir, open, unlink, realpath } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'
import { createCanvasMedia } from './canvas-media.mjs'
import { createContentAssets, localContentAssetPath, contentAssetType } from './content-assets.mjs'
import { contentBase, rewriteContentReferences } from './content-references.mjs'
import { httpError } from './file-lock.mjs'
import { createClipboardContent, validateClipboardContent, executeCanvasCommands, MAX_CLIPBOARD_BYTES, MAX_CLIPBOARD_FILES, MAX_CLIPBOARD_FILE_BYTES, MAX_CLIPBOARD_RESOURCE_BYTES } from '../engine/index.js'

const virtual = 'http://cowart.local'
const limits = { maxFileBytes: MAX_CLIPBOARD_FILE_BYTES, maxBytes: MAX_CLIPBOARD_RESOURCE_BYTES, maxFiles: MAX_CLIPBOARD_FILES, recursiveText: true, preserveUrls: true }
const attribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const kindOf = type => /^(?:text\/javascript|application\/javascript)/i.test(type) ? 'javascript' : /^text\/css/i.test(type) ? 'css' : /^(?:text\/html|image\/svg\+xml)/i.test(type) ? 'html' : null

function inlineHtml(value) {
  const match = /^data:text\/html((?:;[^,]*)?),([\s\S]*)$/i.exec(value)
  if (!match) return null
  const input = Buffer.from(match[2]), bytes = Buffer.allocUnsafe(input.length)
  let length = 0
  for (let i = 0; i < input.length; i++) {
    if (input[i] === 37 && /^[\da-f]{2}$/i.test(input.subarray(i + 1, i + 3).toString())) { bytes[length++] = parseInt(input.subarray(i + 1, i + 3).toString(), 16); i += 2 }
    else bytes[length++] = input[i]
  }
  let decoded = bytes.subarray(0, length)
  if (/;base64$/i.test(match[1])) {
    const base64 = decoded.toString('latin1').replace(/[\t\n\r\f ]/g, '')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1 || base64.includes('=') && base64.length % 4) throw httpError('内部HTML的数据地址无效。')
    decoded = Buffer.from(base64, 'base64')
  }
  if (decoded.length > MAX_CLIPBOARD_BYTES) throw httpError('内部HTML超过大小上限。', 413)
  return decoded.toString('utf8')
}
function rewriteText(source, base, kind, resolve) {
  const actual = kind === 'html' ? contentBase(source, base) : base
  return rewriteContentReferences(source, (value, item) => {
    if (item.tag === 'base') return '/'
    if (item.module && !/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value)) return value
    const replacement = resolve(value, actual)
    // A base is resolved once; local target URLs must not inherit an external base.
    const result = replacement === value && actual !== base ? new URL(value, actual).href : replacement
    return item.attribute ? attribute(result) : result
  }, { modules: true, kind, maxBytes: MAX_CLIPBOARD_BYTES })
}

// These are resource-bearing fields, not arbitrary strings or navigation links.
function mapFields(content, map) {
  for (const asset of content.assets) for (const key of ['src', 'image', 'favicon']) if (typeof asset.props[key] === 'string') asset.props[key] = map(asset.props[key], virtual + '/')
  for (const shape of content.shapes) {
    const source = shape.meta?.cowartHtmlDraftAssetUrl
    const base = typeof source === 'string' && source ? new URL(source, virtual + '/').href : virtual + '/'
    if (shape.type === 'embed') shape.props.url = map(shape.props.url, base)
    if (source) shape.meta.cowartHtmlDraftAssetUrl = map(source, virtual + '/')
  }
  return content
}
function references(text, base, kind, visit) {
  if (kind === 'html') base = contentBase(text, base)
  rewriteContentReferences(text, (value, item) => {
    if (item.tag === 'base' || item.module && !/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value)) return value
    visit(value, base)
    return value
  }, { modules: true, kind })
}
function local(value, base, board, parentOrigin) {
  return localContentAssetPath(value, base, parentOrigin, board)?.path
}

export function createClipboardAssets(workspace) {
  const media = createCanvasMedia(workspace), collect = createContentAssets(workspace, limits)
  async function copy(id, { ids, expectedRevision, parentOrigin = virtual }) {
    const state = await workspace.read(id)
    if (state.revision !== expectedRevision) throw httpError('复制前画板版本已变化。', 409)
    const content = createClipboardContent(state.snapshot, ids, { boardId: id }), roots = new Set()
    const visit = (value, base) => {
      const path = local(value, base, id, parentOrigin)
      if (path) roots.add(path)
    }
    const canonical = (value, base) => {
      const path = local(value, base, id, parentOrigin)
      if (!path) return value
      const url = new URL(value, base)
      return virtual + path + url.search + url.hash
    }
    mapFields(content, (value, base) => {
      const inline = inlineHtml(value)
      if (inline !== null) {
        references(inline, base, 'html', visit)
        return `data:text/html;base64,${Buffer.from(rewriteText(inline, base, 'html', canonical)).toString('base64')}`
      }
      else {
        if (value.startsWith('blob:')) throw httpError('临时资源不能跨画板复制。')
        visit(value, base)
      }
      return canonical(value, base)
    })
    // One discovery pass enforces total quotas before any target is touched.
    const html = [...roots].map(path => `<img src="${attribute(path)}">`).join('')
    const packed = await collect(html, { conversationId: id, parentOrigin })
    for (const [url, file] of packed.files) if (url !== packed.path) {
      const kind = kindOf(file.type), bytes = kind ? Buffer.from(rewriteText(file.bytes.toString('utf8'), virtual + url, kind, canonical)) : file.bytes
      content.resources.push({ url, mimeType: file.type, data: bytes.toString('base64') })
    }
    const result = validateClipboardContent(content)
    if ((await workspace.read(id)).revision !== expectedRevision) throw httpError('复制期间画板版本已变化。', 409)
    return result
  }
  async function prepare(id, command, parentOrigin, snapshot) {
    const content = validateClipboardContent(command.content), board = content.origin.boardId
    const resources = new Map(content.resources.map(resource => {
      const path = local(resource.url, virtual + '/', board, parentOrigin)
      if (!path || path !== resource.url) throw httpError('剪贴板资源路径无效。', 403)
      if (resource.mimeType.toLowerCase() !== contentAssetType(path).toLowerCase()) throw httpError('剪贴板资源格式与文件类型不一致。')
      return [path, { ...resource, bytes: Buffer.from(resource.data, 'base64') }]
    }))
    const reached = new Set(), queue = []
    const visit = (value, base) => {
      const path = local(value, base, board, parentOrigin)
      if (path && !resources.has(path)) throw httpError('剪贴板缺少本地资源。')
      if (path && !reached.has(path)) { reached.add(path); queue.push(path) }
    }
    mapFields(content, (value, base) => {
      const inline = inlineHtml(value)
      if (inline !== null) references(inline, base, 'html', visit)
      else { if (value.startsWith('blob:')) throw httpError('剪贴板含临时资源。'); visit(value, base) }
      return value
    })
    while (queue.length) {
      const path = queue.shift(), resource = resources.get(path), kind = kindOf(resource.mimeType)
      if (kind) references(resource.bytes.toString('utf8'), virtual + path, kind, visit)
    }
    if (resources.size !== reached.size) throw httpError('剪贴板含未引用的附件。')
    const destinations = new Map()
    for (const path of resources.keys()) destinations.set(path, await media.assetDestination(id, decodeURIComponent(basename(path))))
    const rewrite = (value, base) => {
      const path = local(value, base, board, parentOrigin)
      if (!path) return value
      const url = new URL(value, base)
      const replacement = destinations.get(path).assetUrl + (url.search + url.hash).replace(/["'<>\\]/g, c => encodeURIComponent(c))
      return replacement
    }
    const text = (source, base, kind) => rewriteText(source, base, kind, rewrite)
    mapFields(content, (value, base) => {
      const inline = inlineHtml(value)
      return inline !== null ? `data:text/html;base64,${Buffer.from(text(inline, base, 'html')).toString('base64')}` : rewrite(value, base)
    })
    content.resources = []
    const prepared = { ...command, content }
    // Validate final record relations, IDs, placement and rewritten content before writing.
    executeCanvasCommands(snapshot, [prepared])
    const files = [...resources].map(([path, resource]) => {
      const kind = kindOf(resource.mimeType)
      const bytes = kind ? Buffer.from(text(resource.bytes.toString('utf8'), virtual + path, kind)) : resource.bytes
      return { ...destinations.get(path), bytes }
    })
    if (files.some(file => file.bytes.length > MAX_CLIPBOARD_FILE_BYTES) || files.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_CLIPBOARD_RESOURCE_BYTES) throw httpError('重写后的剪贴板资源超过上限。', 413)
    return { command: prepared, files }
  }
  async function paste(id, { expectedRevision, commands, parentOrigin = virtual }, actor) {
    if (!Array.isArray(commands) || commands.length !== 1 || commands[0]?.type !== 'paste_content') throw httpError('需要一次内部粘贴命令。')
    const created = []
    try {
      return await workspace.submitCommands(id, expectedRevision, actor, async snapshot => {
        const prepared = await prepare(id, commands[0], parentOrigin, snapshot)
        if (prepared.files.length) {
          const dir = await workspace.assetsDir(id)
          await mkdir(dir, { recursive: true })
          const delta = relative(await realpath((await workspace.storageFor(id)).canvasDir), await realpath(dir))
          if (delta === '..' || delta.startsWith('..' + sep) || delta.startsWith(sep)) throw httpError('目标资源目录不能指向画板外。', 403)
        }
        for (const file of prepared.files) {
          const handle = await open(file.assetPath, 'wx', 0o600)
          created.push(file.assetPath)
          try { await handle.writeFile(file.bytes) } finally { await handle.close() }
        }
        return [prepared.command]
      })
    } catch (error) {
      // Only files created by this attempt, never a pre-existing target file.
      const cleanup = await Promise.allSettled(created.map(path => unlink(path)))
      const failures = cleanup.filter(r => r.status === 'rejected' && r.reason.code !== 'ENOENT')
      if (failures.length) throw new AggregateError([error, ...failures.map(r => r.reason)], '粘贴失败且新资源清理不完整。')
      throw error
    }
  }
  return { copy, paste }
}
