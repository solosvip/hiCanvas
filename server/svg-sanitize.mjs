import { DOMParser, DOMImplementation, XMLSerializer, onWarningStopParsing } from '@xmldom/xmldom'
import { decodeImageUpload } from './image-upload.mjs'
import { svgLimits, svgError, preflightSvg, charge } from './svg-budget.mjs'
import { svgNamespace, identifier, elementAttributes, presentation, attributeValue, pathCost, numberList, pixelLength } from './svg-values.mjs'
import { sanitizeSvgStyles, matchesSvgSelector } from './svg-styles.mjs'
import { checkSvgReferences } from './svg-references.mjs'

const xlink = 'http://www.w3.org/1999/xlink', xml = 'http://www.w3.org/XML/1998/namespace', xmlns = 'http://www.w3.org/2000/xmlns/'
const drawables = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use'])

function parse(source) {
  preflightSvg(source)
  let document
  try { document = new DOMParser({ onError: onWarningStopParsing }).parseFromString(source, 'application/xml') }
  catch { svgError('XML 语法无效') }
  const root = document.documentElement
  if (!root || root.localName !== 'svg' || root.namespaceURI !== svgNamespace || document.doctype) svgError('需要 SVG 命名空间的单个根元素')
  for (let child = document.firstChild; child; child = child.nextSibling) {
    if (child === root || [7, 8].includes(child.nodeType) || child.nodeType === 3 && !child.data.trim()) continue
    svgError('根元素外存在内容')
  }
  const pending = [{ element: root, depth: 1 }], actual = {}, ids = new Set()
  while (pending.length) {
    const { element, depth } = pending.pop()
    charge(actual, 'nodes')
    if (depth > svgLimits.depth) svgError('嵌套深度超出限制')
    if (element.nodeType === 1) {
      if (element.attributes.length > svgLimits.perElement) svgError('单元素属性超出限制')
      charge(actual, 'attributes', element.attributes.length)
      const id = element.getAttribute('id')
      if (id && identifier.test(id)) { if (ids.has(id)) svgError('ID 重复'); ids.add(id) }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) pending.push({ element: child, depth: depth + Number(child.nodeType === 1) })
  }
  return root
}
function rebuildSvg(source) {
  const sourceRoot = parse(source), document = new DOMImplementation().createDocument(svgNamespace, 'svg', null)
  const output = document.documentElement, budget = {}, warnings = new Set(), nodes = [], styles = [], removedIds = new Set()
  let painted = 0
  const warn = value => warnings.add(value)
  function discard(element) {
    const pending = [element]
    while (pending.length) {
      const current = pending.pop()
      if (current.nodeType !== 1) continue
      const id = current.getAttribute('id'); if (id && identifier.test(id)) removedIds.add(id)
      for (let child = current.firstChild; child; child = child.nextSibling) pending.push(child)
    }
    warn('已移除不支持的元素（含脚本、foreignObject、动画、滤镜、pattern或SVG字体）')
  }
  function copy(element, parent, depth = 1, drawing = true) {
    charge(budget, 'nodes')
    if (depth > svgLimits.depth) svgError('嵌套深度超出限制')
    const tag = element.localName
    if (element.namespaceURI !== svgNamespace || !elementAttributes.has(tag)) { discard(element); return null }
    drawing &&= !['defs', 'symbol', 'clipPath', 'mask', 'marker'].includes(tag)
    const target = element === sourceRoot ? output : document.createElementNS(svgNamespace, tag)
    if (element !== sourceRoot) parent.appendChild(target)
    const node = { tag, id: null, classes: [], children: [], references: [], parameters: 0, vertices: ['line'].includes(tag) ? 2 : 0, paths: ['line', 'polyline', 'polygon', 'path'].includes(tag) ? 1 : 0, paints: Number(drawables.has(tag) && tag !== 'use'), rasterPixels: 0 }
    nodes.push(node)
    const href = element.getAttributeNode('href'), oldHref = element.getAttributeNodeNS(xlink, 'href')
    if (href && oldHref && href.value !== oldHref.value) svgError('href 与 xlink:href 冲突')
    if (element.attributes.length > svgLimits.perElement) svgError('单元素属性超出限制')
    charge(budget, 'attributes', element.attributes.length)
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes.item(i)
      if (attribute.namespaceURI === xmlns) continue
      if (href && attribute === oldHref) continue // Identical aliases describe one reference/image.
      const name = attribute.namespaceURI === xlink && attribute.localName === 'href' ? 'href' : attribute.namespaceURI === xml && attribute.localName === 'space' && ['text', 'tspan'].includes(tag) ? 'xml:space' : attribute.namespaceURI ? null : attribute.name
      if (!name || !['id', 'class', 'style', 'xml:space'].includes(name) && !elementAttributes.get(tag).has(name) && !presentation.has(name)) { warn('已移除不支持的属性'); continue }
      if (name === 'style') {
        const style = sanitizeSvgStyles(attribute.value, { inline: true, budget, warn })
        styles.push({ node, style, target, inline: true }); continue
      }
      if (name === 'href' && tag === 'image') {
        if (!attribute.value.startsWith('data:')) { warn('已移除外部图片引用'); continue }
        const image = decodeImageUpload(attribute.value)
        charge(budget, 'rasters'); charge(budget, 'rasterBytes', image.bytes.length); charge(budget, 'rasterPixels', image.w * image.h)
        node.rasterPixels = image.w * image.h
        target.setAttribute('href', `data:${image.mimeType};base64,${image.bytes.toString('base64')}`); continue
      }
      if (name === 'd' || name === 'points') charge(budget, 'path', Buffer.byteLength(attribute.value))
      const value = attributeValue(tag, name, attribute.value)
      if (!value) { warn('已移除不支持的属性或值'); continue }
      if (name === 'id') node.id = value.value
      if (name === 'class') node.classes = value.value.split(' ')
      if (name === 'd') {
        const cost = pathCost(value.value); node.parameters += cost.parameters; node.vertices = cost.vertices; node.paths = cost.paths
      }
      if (name === 'points') { node.parameters += numberList(value.value).length; node.vertices = node.parameters / 2 + Number(tag === 'polygon') }
      if (value.reference) node.references.push({ ...value.reference, remove: () => target.removeAttribute(name) })
      if (name === 'xml:space') target.setAttributeNS(xml, name, value.value)
      else target.setAttribute(name, value.value)
    }
    charge(budget, 'parameters', node.parameters)
    if (tag === 'style') {
      const style = sanitizeSvgStyles(element.textContent, { budget, warn })
      styles.push({ style, target, inline: false })
    } else if (tag === 'title' || tag === 'desc') target.appendChild(document.createTextNode(element.textContent))
    else for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) { const copied = copy(child, target, depth + 1, drawing); if (copied) node.children.push(copied) }
      else if ([3, 4].includes(child.nodeType) && ['text', 'tspan'].includes(tag)) { charge(budget, 'nodes'); target.appendChild(document.createTextNode(child.data)) }
    }
    if (drawing && drawables.has(tag) && (tag !== 'image' || node.rasterPixels)) painted++
    return node
  }
  copy(sourceRoot, null)
  for (const { style, node: owner, inline } of styles) for (const rule of style.rules) {
    const references = rule.declarations.filter(declaration => declaration.reference)
    if (!references.length) continue
    const matching = inline ? [owner] : nodes.filter(node => rule.selectors.some(selector => matchesSvgSelector(node, selector)))
    for (const node of matching) for (const declaration of references) {
      // Bound matches before building the graph, as a single CSS rule can
      // otherwise multiply references by every matching node.
      charge(budget, 'references')
      node.references.push({ ...declaration.reference, remove: () => { declaration.removed = true }, removed: () => declaration.removed })
    }
  }
  budget.references = 0
  checkSvgReferences(nodes, removedIds, warn, budget)
  for (const { style, target, inline } of styles) {
    const value = style.render()
    if (inline) { if (value) target.setAttribute('style', value) }
    else if (value) target.appendChild(document.createTextNode(value))
    else target.parentNode.removeChild(target)
  }
  const w = pixelLength(output.getAttribute('width')), h = pixelLength(output.getAttribute('height'))
  if ([w, h].some(value => value !== null && (value <= 0 || value > 16384)) || w && h && w * h > 64 * 1024 * 1024) svgError('图片尺寸超限')
  if (!painted) svgError('净化后没有可绘制内容')
  const bytes = Buffer.from(new XMLSerializer().serializeToString(document))
  if (bytes.length > svgLimits.bytes) svgError('净化结果超过 2 MiB')
  return { bytes, mimeType: 'image/svg+xml', extension: 'svg', isAnimated: false, warnings: [...warnings].slice(0, 16) }
}

export function sanitizeSvg(source) {
  const clean = rebuildSvg(source)
  // Exactly one independent second pass rechecks XML/CSS, quotas and graph
  // invariants. A prepare result must also survive the final upload sanitizer.
  const checked = rebuildSvg(clean.bytes.toString())
  if (!clean.bytes.equals(checked.bytes)) svgError('规范结果不稳定')
  return clean
}

export function decodeSvgUpload(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(svgLimits.bytes / 3) * 4 + 32) svgError('文件超过 2 MiB')
  const match = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match || match[1].length % 4) svgError('需要 base64 SVG 数据')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.toString('base64') !== match[1]) svgError('base64 编码无效')
  if (bytes.length > svgLimits.bytes) svgError('文件超过 2 MiB')
  let source
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { svgError('需要合法 UTF-8') }
  return sanitizeSvg(source)
}
