// Compatibility for pinned fontkit 3.0.0 and author Shantell Sans 1.011.
// Consumer-side instance repair; only installed-version metadata is imported.
// No runtime I/O, Node, DOM, dependency writes or font byte writes.
// OpenType GPOS ValueRecord offsets in PairPosFormat1 are relative to PairSet.
// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#value-record
// https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview#coordinate-scales-and-normalization
// Keep private decoded-font access isolated here; upgrade only with the glyph
// advance/DOM regression. Original font bytes and installed dependencies stay intact.
// Call immediately after getVariation, before the instance has laid out any glyphs.
// fontkit does not export its version. Read only its package metadata (bundled
// as JSON); never infer compatibility from a caller-supplied version string.
import fontkitMetadata from '../node_modules/fontkit/package.json' with { type: 'json' }

export function assertFontkitVersion(version = fontkitMetadata.version) {
  if (version !== '3.0.0') throw new Error(`fontkit ${version} 未经可变字距适配验证，请重新评估后再使用。`)
}
assertFontkitVersion()

const repairedGPOS = new WeakSet()
const fields = ['xPlacement','yPlacement','xAdvance','yAdvance','xPlaDevice','yPlaDevice','xAdvDevice','yAdvDevice']
const fixed16 = x => Math.sign(x) * Math.round(Math.abs(x) * 65536) / 65536
export function normalizedCoordinates(font) {
  const coords = font.fvar.axis.map((axis,i) => {
    const value = fixed16(font.variationCoords[i])
    if (value === axis.defaultValue) return 0
    const extent = value < axis.defaultValue ? axis.defaultValue-axis.minValue : axis.maxValue-axis.defaultValue
    return fixed16((value-axis.defaultValue)/extent)
  })
  font.avar?.segment.forEach((segment,i) => {
    for (let j=1;j<segment.correspondence.length;j++) {
      const left=segment.correspondence[j-1],right=segment.correspondence[j]
      if (coords[i] < right.fromCoord) {
        coords[i]=fixed16(left.toCoord+(coords[i]-left.fromCoord)*(right.toCoord-left.toCoord)/(right.fromCoord-left.fromCoord))
        break
      }
    }
  })
  return coords.map(x => ((x*65536+2)>>2)/16384)
}
function repairPairSetDevices(font) {
  const gpos = font.GPOS
  if (!gpos || repairedGPOS.has(gpos)) return
  const bytes = font.stream.buffer
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const visitedLookups = new WeakSet(), visitedPairs = new WeakSet()
  const repair = (pairSet, subtable) => {
    if (visitedPairs.has(pairSet)) return
    for (const record of pairSet) for (const number of [1, 2]) {
      const value = record['value' + number], format = subtable['valueFormat' + number]
      let fieldOffset = value._startOffset
      for (const key of fields) {
        if (!format[key]) continue
        if (key.endsWith('Device')) {
          const relative = view.getUint16(fieldOffset)
          if (relative) {
            const offset = pairSet._startOffset + relative
            const corrected = { a: view.getUint16(offset), b: view.getUint16(offset + 2), deltaFormat: view.getUint16(offset + 4) }
            if (corrected.deltaFormat !== 0x8000) throw new Error('Shantell字距表与锁定版本不一致。')
            value[key] = corrected
          }
        }
        fieldOffset += 2
      }
    }
    visitedPairs.add(pairSet)
  }
  // Keep the font's lazy parsing: most boards use a tiny fraction of its pairs.
  // Patch on first access, before fontkit consumes the decoded ValueRecord.
  const lookup = gpos.lookupList.get.bind(gpos.lookupList)
  gpos.lookupList.get = index => {
    const item = lookup(index)
    if (!item || visitedLookups.has(item)) return item
    for (const outer of item.subTables) {
      const subtable = outer.extension || outer, pairs = subtable.pairSets
      if (!pairs) continue
      const get = pairs.get.bind(pairs)
      pairs.get = index => { const value = get(index); if (value) repair(value, subtable); return value }
    }
    visitedLookups.add(item)
    return item
  }
  repairedGPOS.add(gpos)
}
export function applyChromiumVariableMetrics(font) {
  if (!font.fvar) return font
  repairPairSetDevices(font)
  const processor=font._variationProcessor
  processor.normalizedCoords=normalizedCoordinates(font)
  processor.blendVectors.clear()
  // Browser-matching fractional HVAR metrics: intentionally avoid fontkit's Math.round.
  processor.getAdvanceAdjustment=function(glyphId,table) {
    const mapping=table.advanceWidthMapping
    const {outerIndex,innerIndex}=mapping ? mapping.mapData[Math.min(glyphId,mapping.mapCount-1)] : {outerIndex:0,innerIndex:glyphId}
    return this.getDelta(table.itemVariationStore,outerIndex,innerIndex)
  }
  return font
}
