import { DOMParser } from '@xmldom/xmldom'
import { cleanBookmarkText, normalizeBookmarkMetadata } from '../model/index.js'
import { BookmarkError, bookmarkReference } from './bookmark-address.mjs'

const fail = () => { throw new BookmarkError('invalid_html') }

function encoding(bytes, contentType) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  const declarations = [...contentType.matchAll(/;\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/gi)].map(m => m[1] ?? m[2] ?? m[3])
  let candidates = declarations
  if (!candidates.length) {
    // Only the bounded prescan is Latin-1. The selected fatal decoder handles
    // the entire head, including characters spanning network chunks.
    const prefix = new HeadScanner(false)
    prefix.write(bytes.subarray(0,1024).toString('latin1'))
    candidates = prefix.charsets
  }
  if (!candidates.length) return 'utf-8'
  const labels = candidates.map(label => {
    let normalized
    try { normalized = new TextDecoder(label.trim(),{fatal:true}).encoding } catch { fail() }
    // HTML meta declarations cannot switch the byte stream to UTF-16. A BOM
    // or the transport header can; both have already won before this branch.
    return !declarations.length && /^utf-16(?:le|be)$/.test(normalized) ? 'utf-8' : normalized
  })
  if (new Set(labels).size !== 1) fail()
  return labels[0]
}

function text(value, limit) {
  if (Buffer.byteLength(value) > 16384) fail()
  // The page itself is never given to a DOM parser. Escaping markup first
  // makes DOCTYPE, tags and attributes inert; only short text entities decode.
  const escaped = value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi,(entity,hex,decimal)=>{
    const code=parseInt(hex ?? decimal,hex ? 16 : 10)
    return !code || code>0x10ffff || (code>=0xd800 && code<=0xdfff) ? '&#xfffd;' : entity
  }).replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const document = new DOMParser({ onError() {} }).parseFromString(`<span>${escaped}</span>`, 'text/html')
  return cleanBookmarkText(document.documentElement.textContent, limit)
}

function attributes(token) {
  const result = new Map()
  let count = 0
  const body = token.replace(/^<\/?[a-z][a-z0-9:-]*/i,'').replace(/\/?\s*>$/,'')
  const pattern = /\s+([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gy
  let offset = 0
  while (offset < body.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(body)
    if (!match) { if (body.slice(offset).trim()) fail(); break }
    if (++count > 32) fail()
    const name = match[1].toLowerCase()
    if (!result.has(name)) result.set(name,match[2] ?? match[3] ?? match[4] ?? '')
    offset = pattern.lastIndex
  }
  return result
}

class HeadScanner {
  constructor(collect = true) { this.collect = collect }
  done = false
  mode = 'data'
  token = ''
  tokenBytes = 0
  quote = ''
  raw = ''
  rawBytes = 0
  rawName = ''
  rawClose = ''
  tags = 0
  fields = new Map()
  canonical = []
  charsets = []
  templateDepth = 0

  write(chunk) {
    for (const char of chunk) {
      if (this.done) break
      if (this.mode === 'comment' || this.mode === 'cdata') {
        this.token = (this.token + char).slice(-3)
        if (this.token === (this.mode === 'comment' ? '-->' : ']]>')) { this.mode = 'data'; this.token = '' }
      } else if (this.mode === 'bogus') {
        if (char === '>') { if (++this.tags > 2048) fail(); this.mode = 'data' }
      } else if (this.mode === 'raw') this.rawChar(char)
      else if (this.mode === 'tag') {
        this.token += char
        this.tokenBytes += Buffer.byteLength(char)
        if (this.tokenBytes > 16384) fail()
        if (this.token === '<!--') { this.mode = 'comment'; this.token = ''; continue }
        if (this.templateDepth && this.token === '<![CDATA[') { this.mode = 'cdata'; this.token = ''; continue }
        const lower = this.token.toLowerCase()
        if ((this.token.length === 2 && !/[a-z!/]/i.test(char)) ||
          (this.token.length === 3 && this.token.startsWith('</') && !/[a-z]/i.test(char)) ||
          (this.token.startsWith('<!') && !'<!--'.startsWith(this.token) && !'<!doctype'.startsWith(lower) && !lower.startsWith('<!doctype') &&
            !(this.templateDepth && '<![CDATA['.startsWith(this.token)))) {
          this.mode = char === '>' ? 'data' : 'bogus'
          if (char === '>' && ++this.tags > 2048) fail()
          this.token = ''; continue
        }
        if (this.quote) { if (char === this.quote) this.quote = '' }
        else if (char === '"' || char === "'") this.quote = char
        else if (char === '>') { this.tag(this.token); this.token = ''; if (this.mode === 'tag') this.mode = 'data' }
      } else if (char === '<') { this.mode = 'tag'; this.token = '<'; this.tokenBytes = 1 }
      else if (!this.templateDepth && !/\s/u.test(char)) this.done = true
    }
  }

  rawChar(char) {
    if (this.rawName === 'plaintext') return
    if (this.rawClose || char === '<') {
      this.rawClose += char
      if (this.rawClose.length > 16384) fail()
      const expected = `</${this.rawName}`
      const lower = this.rawClose.toLowerCase()
      if (lower === expected + '>' || (lower.startsWith(expected) && /^\s*>$/.test(lower.slice(expected.length)))) {
        if (this.rawName === 'title' && !this.templateDepth) this.store('title', this.raw, 300)
        this.raw = ''; this.rawBytes = 0; this.rawClose = ''; this.mode = 'data'; return
      }
      if (expected.startsWith(lower) || (lower.startsWith(expected) && /^\s*$/.test(lower.slice(expected.length)))) return
      if (this.rawName === 'title') this.appendRaw(this.rawClose)
      this.rawClose = ''
    } else if (this.rawName === 'title') this.appendRaw(char)
  }

  appendRaw(value) {
    this.rawBytes += Buffer.byteLength(value)
    if (this.rawBytes > 16384) fail()
    this.raw += value
  }

  store(name, value, limit) {
    if (!this.collect) return
    if (this.fields.has(name)) return
    const cleaned = text(value,limit)
    if (cleaned) this.fields.set(name,cleaned)
  }

  tag(token) {
    if (++this.tags > 2048) fail()
    if (/^<!doctype\s/i.test(token)) { if (token.includes('[')) fail(); return }
    const name = /^<(\/?[a-z][a-z0-9:-]*)\b/i.exec(token)?.[1]?.toLowerCase()
    if (!name) return
    const attrs = attributes(token)
    if (this.templateDepth) {
      if (name === 'template') this.templateDepth++
      else if (name === '/template') this.templateDepth--
      else if (['script','style','title','noscript','textarea','iframe','xmp','noembed','noframes','plaintext'].includes(name)) { this.mode = 'raw'; this.rawName = name }
      return
    }
    if (name === '/head' || name === 'body' || name === '/html') { this.done = true; return }
    if (name === 'template') { this.templateDepth = 1; return }
    if (['html','head','base','/title','/script','/style','/noscript','/template'].includes(name)) return
    if (['script','style','title','noscript'].includes(name)) { this.mode = 'raw'; this.rawName = name; return }
    if (name === 'meta') {
      if (attrs.has('charset')) this.charsets.push(attrs.get('charset'))
      else if ((attrs.get('http-equiv') || '').toLowerCase() === 'content-type') {
        const charset = /;\s*charset\s*=\s*([^\s;]+)/i.exec(attrs.get('content') || '')?.[1]
        if (charset) this.charsets.push(charset)
      }
      const property = (attrs.get('property') || attrs.get('name') || '').toLowerCase()
      if (['og:title','og:description','description'].includes(property)) this.store(property, attrs.get('content') || '', property === 'og:title' ? 300 : 1000)
    } else if (name === 'link') {
      if ((attrs.get('rel') || '').toLowerCase().split(/\s+/).includes('canonical') && attrs.has('href')) this.canonical.push(attrs.get('href'))
    } else this.done = true // A non-head element begins the implicit body.
  }

  end() {
    if (!this.done && this.mode === 'raw' && this.rawName === 'title' && !this.templateDepth) this.store('title',this.raw + this.rawClose,300)
    this.done = true
  }
}

export function createBookmarkHead(contentType, finalUrl) {
  const scan = new HeadScanner()
  let pending = Buffer.alloc(0)
  let probe = new HeadScanner(false)
  let probed = 0
  let decoder
  let count = 0
  let finished = false
  function decode(bytes, end = false) {
    try { scan.write(decoder.decode(bytes,{ stream:!end })) } catch { fail() }
  }
  return {
    get done() { return scan.done },
    write(bytes) {
      if (finished || scan.done) return
      // Work in small pieces so a complete head can end consumption before an
      // arbitrarily large body in the same socket chunk. Prescan stays bounded.
      for (let offset = 0; offset < bytes.length && !scan.done; offset += 1024) {
        const part = bytes.subarray(offset, Math.min(offset + 1024, bytes.length))
        count += part.length
        if (count > 128 * 1024) fail()
        if (!decoder) {
          pending = Buffer.concat([pending,part])
          if (pending.length < 3) continue
          const bom = (pending[0]===0xef && pending[1]===0xbb && pending[2]===0xbf) ||
            (pending[0]===0xff && pending[1]===0xfe) || (pending[0]===0xfe && pending[1]===0xff)
          if (probe && !bom) {
            try { probe.write(pending.subarray(probed).toString('latin1'));probed=pending.length } catch { probe=null }
          }
          if (!bom && !/;\s*charset\s*=/i.test(contentType) && pending.length < 1024 && !probe?.done) continue
          decoder = new TextDecoder(encoding(pending,contentType), { fatal:true })
          decode(pending); pending = Buffer.alloc(0)
        } else decode(part)
      }
    },
    finish() {
      if (finished) fail()
      finished = true
      if (!decoder) { decoder = new TextDecoder(encoding(pending,contentType), { fatal:true }); decode(pending,true) }
      else if (!scan.done) decode(Buffer.alloc(0),true)
      // Called only after a clean upstream EOF or intentional early head stop.
      // Incomplete HTTP framing/connection errors never reach this method.
      scan.end()
      let url = finalUrl
      for (const candidate of scan.canonical) {
        try {
          const normalized = bookmarkReference(text(candidate,8192),finalUrl)
          if (normalized.origin === new URL(finalUrl).origin) { url = normalized.href; break }
        } catch { /* Invalid/cross-origin canonical is data, never a request. */ }
      }
      return normalizeBookmarkMetadata({ title:scan.fields.get('og:title') || scan.fields.get('title') || '', description:scan.fields.get('og:description') || scan.fields.get('description') || '', url })
    },
  }
}
