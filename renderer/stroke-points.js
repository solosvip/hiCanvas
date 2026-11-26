// Persisted wire format documented by @tldraw/tlschema 5.1.1 (MIT),
// src/misc/b64Vecs.ts: first xyz = little-endian float32; subsequent xyz =
// accumulated float16 deltas. Independent decoder, with no schema barrel
// import: that barrel includes browser-only instance/Store helpers.
const half = bits => {
  const sign = bits & 0x8000 ? -1 : 1, exponent = bits >>> 10 & 31, fraction = bits & 1023
  return sign * (exponent === 31 ? fraction ? NaN : Infinity : exponent ? (1 + fraction / 1024) * 2 ** (exponent - 15) : fraction * 2 ** -24)
}

export function decodeStrokePoints(encoded) {
  if (!encoded) return []
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  if (bytes.length < 12 || (bytes.length - 12) % 6) return []
  const view = new DataView(bytes.buffer), coordinates = [0, 4, 8].map(offset => view.getFloat32(offset, true))
  const points = [{ x: coordinates[0], y: coordinates[1], z: coordinates[2] }]
  for (let offset = 12; offset < bytes.length; offset += 6) {
    for (let axis = 0; axis < 3; axis++) coordinates[axis] += half(view.getUint16(offset + axis * 2, true))
    points.push({ x: coordinates[0], y: coordinates[1], z: coordinates[2] })
  }
  return points
}
