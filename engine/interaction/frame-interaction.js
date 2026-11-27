import { reverseRecordsDiff, squashRecordDiffs } from '@tldraw/store'
import { isEqual } from '@tldraw/utils'
import { CanvasEditError } from '../errors.js'
import { connectionCoordinates } from './connection-coordinates.js'
import { MAX_REPLAYS } from '../runtime/index.js'

const empty = () => ({ added: {}, updated: {}, removed: {} })
const commandsFor = diff => [
  ...Object.values(diff.added).map(record => ({ type: 'put', record })),
  ...Object.values(diff.updated).map(([, record]) => ({ type: 'put', record })),
  ...(Object.keys(diff.removed).length ? [{ type: 'delete', ids: Object.keys(diff.removed) }] : []),
]

// Pointer policy uses the existing ordered spatial index, never a board scan.
// One pointer target serves the whole selection; only intersecting roots enter.
export function createFrameDrag({ session, index, targets }, starts) {
  let changes = empty()
  const expected = new Map()
  function descendants(id) {
    const ids = new Set([id])
    for (const key of ids) for (const child of targets.records.childIds(key)) ids.add(child)
    return [...ids].sort()
  }
  const membership = new Map(starts.map(start => [start.id, descendants(start.id)]))
  function capture(id, descendants = false) {
    if (expected.has(id)) return
    const record = index.getRecord(id)
    expected.set(id, record || null)
    if (record?.typeName !== 'shape') return
    capture(record.parentId)
    if (descendants) for (const child of targets.records.childIds(id)) capture(child, true)
  }
  starts.forEach(start => capture(start.id, true))
  function preview(commands) {
    if (!commands.length) return
    const result = session.preview(commands)
    for (const [id, before] of [...Object.entries(result.changes.removed), ...Object.entries(result.changes.updated).map(([id, [before]]) => [id, before])]) if (!expected.has(id)) expected.set(id, before)
    for (const id of Object.keys(result.changes.added)) if (!expected.has(id)) expected.set(id, null)
    changes = squashRecordDiffs([changes, result.changes])
    for (const [id, [before, after]] of Object.entries(changes.updated)) if (isEqual(before, after)) delete changes.updated[id]
    return result
  }
  function contain(starts, point) {
    const moving = new Set(starts.map(start => start.id))
    const target = index.hitsAtPoint(point).find(id => index.getRecord(id)?.type === 'frame' && targets.isSelectable(id) && !targets.lineage(id).some(record => moving.has(record.id)))
    const intersections = target ? new Set(starts.filter(start => { const bounds = index.getBounds(start.id); return bounds && index.query(bounds).includes(target) }).map(start => start.id)) : new Set()
    const groups = new Map()
    for (const start of starts) {
      // Entering a group gives access to its children, not permission to
      // dissolve it on an ordinary drag. Container migration moves its root.
      if (index.getRecord(index.getRecord(start.id)?.parentId)?.type === 'group') continue
      const parentId = intersections.has(start.id) ? target : targets.pageId
      if (index.getRecord(start.id)?.parentId === parentId) continue
      if (!groups.has(parentId)) groups.set(parentId, [])
      groups.get(parentId).push(start.id)
    }
    for (const parentId of groups.keys()) capture(parentId)
    preview([...groups].map(([parentId, ids]) => ({ type: 'reparent_shapes', ids, parentId })))
  }
  return {
    preview, contain,
    reset() { const commands = commandsFor(reverseRecordsDiff(changes)); if (commands.length) preview(commands) },
    async commit(starts) {
      const parents = new Map()
      for (const start of starts) {
        const parentId = index.getRecord(start.id)?.parentId
        if (!parentId || parentId === start.parentId) continue
        if (!parents.has(parentId)) parents.set(parentId, [])
        parents.get(parentId).push(start.id)
      }
      if (!parents.size) return session.commitGesture()
      const moved = new Map(starts.filter(start => parents.get(index.getRecord(start.id)?.parentId)?.includes(start.id)).map(start => {
        const record = index.getRecord(start.id)
        return [start.id, { record, parentId: start.parentId, point: connectionCoordinates(index, start.id).page({ x: 0, y: 0 }), rotation: targets.lineage(start.id).reduce((sum, r) => sum + r.rotation, 0) }]
      }))
      session.cancelGesture()
      for (let replay = 0; ; replay++) {
        // A conflict refreshes the confirmed Store. Retry only when every
        // involved subtree/parent is unchanged; unrelated image jobs may land.
        if ([...membership].some(([id, ids]) => !isEqual(descendants(id), ids)) || [...expected].some(([id, before]) => !isEqual(index.getRecord(id) || null, before))) throw new CanvasEditError('拖动涉及的形状或画框已变化，本次操作已取消。', 'conflict')
        const diff = commandsFor({ ...changes, removed: {} }).filter(command => !moved.has(command.record.id))
        for (const [id, intent] of moved) {
          const local = connectionCoordinates(index, intent.parentId).local(intent.point)
          const rotation = intent.rotation - targets.lineage(intent.parentId).reduce((sum, r) => sum + r.rotation, 0)
          diff.push({ type: 'put', record: { ...intent.record, id, parentId: intent.parentId, ...local, rotation } })
        }
        diff.push(...[...parents].map(([parentId, ids]) => ({ type: 'reparent_shapes', ids, parentId })))
        if (Object.keys(changes.removed).length) diff.push({ type: 'delete', ids: Object.keys(changes.removed) })
        try { return await session.commitCommands(diff, { expectedRevision: session.state.get().revision }) }
        catch (error) { if (error.code !== 'conflict' || replay >= MAX_REPLAYS) throw error }
      }
    },
  }
}

export function frameFitCommand(index, ids, handle) {
  if (ids.length !== 1 || handle.kind !== 'resize' || index.getRecord(ids[0])?.type !== 'frame') return null
  const axis = ['left', 'right'].includes(handle.id) ? 'x' : ['top', 'bottom'].includes(handle.id) ? 'y' : 'both'
  return { type: 'fit_frame_to_content', ids, padding: 10, axis }
}

// Capture direct unlocked children only. A nested frame compensates as a whole;
// locked children follow the frame, matching the isolated native observation.
export function captureFrameResize({ index, selection, snapModifier }, ids) {
  const frames = selection.capture(ids).filter(record => record.type === 'frame')
  const children = frames.flatMap(frame => selection.children(frame.id).filter(record => !record.isLocked))
  const original = new Map(children.map(record => [record.id, record]))
  const poses = new Map(children.map(record => [record.id, {
    point: connectionCoordinates(index, record.id).page({ x: 0, y: 0 }),
    rotation: selection.lineage(record.id).reduce((sum, r) => sum + r.rotation, 0),
  }]))
  const membership = () => JSON.stringify(frames.map(frame => selection.children(frame.id).filter(record => !record.isLocked).map(record => record.id).sort()))
  const members = membership()
  let expected = new Map(children.map(record => [record.id, JSON.stringify(record)])), compensated = false, touched = false
  return {
    restore(input) {
      const crop = Boolean(input[snapModifier === 'meta' ? 'metaKey' : 'ctrlKey'])
      touched = crop || compensated
      if (!crop && !compensated) return []
      if (membership() !== members || [...expected].some(([id, value]) => JSON.stringify(index.getRecord(id)) !== value)) throw new CanvasEditError('画框内容已被其他操作更改，本次裁框已取消。', 'conflict')
      return children.map(record => ({ type: 'put', record: original.get(record.id) }))
    },
    compensate(input) {
      const crop = Boolean(input[snapModifier === 'meta' ? 'metaKey' : 'ctrlKey'])
      const commands = crop ? children.map(record => {
        const parent = connectionCoordinates(index, record.parentId)
        const rotation = selection.lineage(record.parentId).reduce((sum, r) => sum + r.rotation, 0)
        const next = { ...parent.local(poses.get(record.id).point), rotation: poses.get(record.id).rotation - rotation }
        for (const key of ['x', 'y', 'rotation']) if (Math.abs(next[key] - record[key]) < 1e-9) next[key] = record[key]
        return { type: 'update', id: record.id, changes: next }
      }) : []
      compensated = crop
      return commands
    },
    accept() { if (touched) expected = new Map(children.map(record => [record.id, JSON.stringify(index.getRecord(record.id))])) },
  }
}
