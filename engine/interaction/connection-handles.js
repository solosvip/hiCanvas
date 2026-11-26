import { getIndexBetween } from '@tldraw/utils'
import { getConnectionGeometry } from '../../renderer/geometry.js'
import { connectionCoordinates, linePoints } from './connection-coordinates.js'

export function connectionMiddle(geometry, kind) {
  const points = geometry.path.points
  if (kind !== 'elbow' || points.length < 4) return geometry.path.at(.5)
  const i = Math.floor((points.length - 1) / 2)
  return { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }
}

// Native public getShapeHandles readbacks, 2026-11-26: arrow start/end
// vertices and virtual middle; line vertices and fractional-index midpoints.
// These are page coordinates; rendering and pointer hits share this data.
export function describeConnection(context, state) {
  if (state.selectedIds.length !== 1 || state.toolId !== 'select') return null
  const shape = context.index.getRecord(state.selectedIds[0])
  if (!shape || !['line', 'arrow'].includes(shape.type) || !context.targets.isSelectable(shape.id)) return null
  const geometry = getConnectionGeometry(shape, context.targets.records), coordinates = connectionCoordinates(context.index, shape.id)
  let handles
  if (shape.type === 'line') {
    const points = linePoints(shape)
    handles = points.flatMap((point, i) => {
      const next = points[i + 1], result = [{ id: point.id, kind: 'vertex', ...coordinates.page(point) }]
      if (next) { const id = getIndexBetween(point.index, next.index); result.push({ id, index: id, kind: 'create', ...coordinates.page({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }) }) }
      return result
    })
  } else handles = [
    ...['start', 'end'].map(id => ({ id, kind: 'vertex', ...coordinates.page(geometry.terminals[id]) })),
    { id: 'middle', kind: shape.props.kind === 'elbow' ? 'elbow' : 'bend', ...coordinates.page(connectionMiddle(geometry, shape.props.kind)) },
  ]
  return { kind: 'connection', id: shape.id, bounds: { x: 0, y: 0, w: 0, h: 0 }, handles }
}
