import { rasterFiles } from './image-fixtures.js'
// Synthetic SVGs only; shared by server tests and the isolated native probe.
export const svg = (body, attributes = 'width="320" height="180"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`
const rect = '<rect width="100%" height="100%" fill="red"/>'
export const svgDimensions = [
  { name: 'explicit', attributes: 'width="320" height="180"', w: 320, h: 180 },
  { name: 'viewbox', attributes: 'viewBox="0 0 320 180"', w: 267, h: 150 },
  { name: 'offset', attributes: 'viewBox="-100 -50 320 180"', w: 267, h: 150 },
  { name: 'percent', attributes: 'width="100%" height="100%" viewBox="0 0 320 180"', w: 267, h: 150 },
  { name: 'inches', attributes: 'width="2in" height="1in"', w: 192, h: 96 },
  { name: 'default', attributes: '', w: 300, h: 150 },
]
export const svgPositive = svg('<defs><linearGradient id="paint"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="clip"><rect width="320" height="180"/></clipPath><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="blue"/></marker><g id="tile"><rect width="50" height="40" fill="lime"/></g></defs><style>.surface { fill: url(#paint) } #label { fill: white; font-size: 20px }</style><rect class="surface" width="320" height="180" clip-path="url(#clip)"/><use href="#tile" x="10" y="10"/><path d="M20 110 L260 110" stroke="blue" stroke-width="6" marker-end="url(#arrow)"/><text id="label" x="20" y="160">SVG &amp; 文字</text>')
export const svgFeatures = svg(`<defs><clipPath id="c"><rect width="40" height="80"/></clipPath><mask id="m" maskUnits="userSpaceOnUse" x="80" y="0" width="80" height="80"><rect x="80" width="40" height="80" fill="white"/></mask><radialGradient id="r"><stop stop-color="yellow"/><stop offset="1" stop-color="blue"/></radialGradient></defs><rect width="80" height="80" fill="red" clip-path="url(#c)"/><rect x="80" width="80" height="80" fill="lime" mask="url(#m)"/><circle cx="40" cy="120" r="35" fill="url(#r)"/><image x="80" y="80" width="80" height="80" href="data:image/png;base64,${rasterFiles.png.base64}"/>`, 'width="160" height="160"')
export const svgAttacks = [
  { name: 'script', source: svg(`${rect}<script>console.log('HICANVAS_SVG_EXEC'); fetch('https://svg-test.invalid/script')</script>`) },
  { name: 'cdata-script', source: svg(`${rect}<script><![CDATA[console.log('HICANVAS_SVG_EXEC')]]></script>`) },
  { name: 'events', source: svg('<rect width="320" height="180" fill="red" onload="console.log(1)" onclick="console.log(2)"/>', 'width="320" height="180" onload="console.log(3)"') },
  { name: 'foreign', source: svg(`${rect}<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://svg-test.invalid/foreign"/><script>console.log('HICANVAS_SVG_EXEC')</script></div></foreignObject>`) },
  { name: 'namespace', source: svg(`${rect}<x:script xmlns:x="http://www.w3.org/2000/svg">console.log('HICANVAS_SVG_EXEC')</x:script><x:image xmlns:x="http://not-svg.invalid" href="https://svg-test.invalid/ns"/>`) },
  { name: 'animation', source: svg(`${rect}<set href="#target" attributeName="href" to="https://svg-test.invalid/set"/><animate attributeName="fill" values="url(https://svg-test.invalid/a);red"/>`) },
  { name: 'references', source: svg(`${rect}<image href="https://svg-test.invalid/image"/><use href="//svg-test.invalid/use"/><image href="file:///synthetic/canary"/>`) },
  { name: 'encoded-url', source: svg(`${rect}<use href="&#x68;ttps://svg-test.invalid/entity"/><path fill="url(&#x68;ttps://svg-test.invalid/paint)" d="M0 0H20V20Z"/>`) },
  { name: 'base-pi', source: `<?xml-stylesheet href="https://svg-test.invalid/style"?>${svg(rect, 'width="320" height="180" xml:base="https://svg-test.invalid/"')}` },
  { name: 'css', source: svg(`${rect}<style>@import 'https://svg-test.invalid/import'; @font-face { font-family: remote; src: url(https://svg-test.invalid/font) } rect { filter: url(https://svg-test.invalid/filter); fill: var(--remote); cursor: url(https://svg-test.invalid/cursor),auto }</style>`) },
  { name: 'css-escape', source: svg(`${rect}<style>rect { fill: u\\72l(https://svg-test.invalid/escaped); stroke: url(/**/https://svg-test.invalid/comment) }</style>`) },
  { name: 'source-map', source: svg(`${rect}<style>rect {opacity:1} /*# sourceMappingURL=file:///synthetic/canary.map */</style>`) },
  { name: 'filters-pattern-font', source: svg(`${rect}<filter id="shadow"><feImage href="https://svg-test.invalid/fe"/></filter><pattern id="pattern"/><font><font-face/></font>`) },
  { name: 'doctype', reject: true, source: `<!DOCTYPE svg SYSTEM "file:///synthetic/canary">${svg(rect)}` },
  { name: 'entity', reject: true, source: `<!DOCTYPE svg [<!ENTITY a "expanded">]>${svg('<text>&a;</text>')}` },
  { name: 'unknown-entity', reject: true, source: svg(`${rect}<text>&unknown;</text>`) },
  { name: 'bad-xml', reject: true, source: svg('<g><rect></g>') },
  { name: 'duplicate-attribute', reject: true, source: svg('<rect width="1" width="2"/>') },
  { name: 'duplicate-id', reject: true, source: svg('<rect id="same"/><circle id="same"/>') },
  { name: 'use-cycle', reject: true, source: svg('<g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g>') },
  { name: 'ancestor-cycle', reject: true, source: svg('<g id="a"><use href="#a"/></g>') },
  { name: 'gradient-cycle', reject: true, source: svg('<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs><rect fill="url(#a)"/>') },
  { name: 'marker-self', reject: true, source: svg('<defs><marker id="a"><path d="M0 0 L1 1" marker-end="url(#a)"/></marker></defs><path d="M0 0 L2 2" marker-end="url(#a)"/>') },
  { name: 'marker-mutual', reject: true, source: svg('<defs><marker id="a"><path d="M0 0 L1 1" marker-end="url(#b)"/></marker><marker id="b"><path d="M0 0 L1 1" marker-end="url(#a)"/></marker></defs><path d="M0 0 L2 2" marker-end="url(#a)"/>') },
  { name: 'wrong-reference', reject: true, source: svg('<rect id="a"/><path d="M0 0L1 1" clip-path="url(#a)"/>') },
  { name: 'dangling', reject: true, source: svg('<use href="#missing"/>') },
  { name: 'nested-svg-data', reject: true, source: svg(`<image href="data:image/svg+xml;base64,${btoa(svg(rect))}"/>`) },
]

export const svgFiles = Object.fromEntries([
  ['svg', svgPositive], ['svg-features', svgFeatures],
  ...svgDimensions.map(value => [`svg-${value.name}`, svg(rect, value.attributes)]),
  ...svgAttacks.map(value => [`svg-${value.name}`, value.source]),
].map(([key, source]) => [key, { name: `${key}.svg`, source, base64: btoa(unescape(encodeURIComponent(source))), mimeType: 'image/svg+xml' }]))
