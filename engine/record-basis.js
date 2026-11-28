import { isEqual } from '@tldraw/utils'
import { CanvasEditError } from './errors.js'

const MAX_RECORDS = 20000, MAX_BYTES = 50 * 1024 * 1024
const invalid = message => { throw new CanvasEditError(message, 'invalid-record-basis') }
const conflict = () => { throw new CanvasEditError('目标或相关记录已变化；草稿未覆盖新内容，请重新确认。', 'conflict') }
const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
function fields(value, names) {
  if (!plain(value) || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) invalid('记录前置条件字段无效。')
}
function jsonBytes(value) {
  try {
    const text = JSON.stringify(value, (_key, item) => {
      if (item === undefined || ['function', 'symbol', 'bigint'].includes(typeof item) || typeof item === 'number' && !Number.isFinite(item)) invalid('记录前置条件必须是JSON文档值。')
      return item
    })
    const bytes = new TextEncoder().encode(text).length
    if (bytes > MAX_BYTES) throw new CanvasEditError('记录前置条件超过请求大小上限。', 'limit')
    return bytes
  } catch (error) {
    if (error instanceof CanvasEditError) throw error
    invalid('记录前置条件不能序列化。')
  }
}
const queryKey = query => `${query.kind}:${query.id}`
const memberKinds = new Set(['children', 'asset-users', 'bindings-from', 'bindings-to'])
function memberIndex(snapshot, queries) {
  const index = new Map()
  for (const query of queries) {
    if (!memberKinds.has(query?.kind) || !validId(query.id)) invalid('未知记录成员条件。')
    index.set(queryKey(query), [])
  }
  // Client conditions must not multiply full-board scans inside the save lock.
  if (index.size) for (const record of Object.values(snapshot.store)) {
    if (record.typeName === 'shape') {
      index.get(`children:${record.parentId}`)?.push(record.id)
      index.get(`asset-users:${record.props.assetId}`)?.push(record.id)
    }
    if (record.typeName === 'binding') {
      index.get(`bindings-from:${record.fromId}`)?.push(record.id)
      index.get(`bindings-to:${record.toId}`)?.push(record.id)
    }
  }
  for (const ids of index.values()) ids.sort()
  return index
}
const validId = id => typeof id === 'string' && /^(page|shape|asset|binding):.+/.test(id)
function checked(basis, dependencies) {
  fields(basis, ['version', 'records', 'memberships'])
  if (basis.version !== 1 || !Array.isArray(basis.records) || !Array.isArray(basis.memberships)) invalid('记录前置条件版本或格式无效。')
  if (basis.records.length + basis.memberships.length > MAX_RECORDS) throw new CanvasEditError('记录前置条件数量超过上限。', 'limit')
  if (jsonBytes(basis) + (dependencies.commandBytes || 0) > MAX_BYTES) throw new CanvasEditError('命令与记录前置条件合计超过请求上限。', 'limit')
  const records = new Map()
  for (const entry of basis.records) {
    if (!Array.isArray(entry) || entry.length !== 2) invalid('记录前置条件需要ID和原值。')
    const [id, value] = entry
    if (!validId(id) || records.has(id) || value !== null && (!plain(value) || value.id !== id || !['page', 'shape', 'asset', 'binding'].includes(value.typeName))) invalid('记录前置条件包含无效或重复记录。')
    records.set(id, value)
  }
  const queries = new Set()
  for (const query of basis.memberships) {
    fields(query, ['kind', 'id', 'ids'])
    const key = queryKey(query)
    if (!memberKinds.has(query.kind) || !validId(query.id) || queries.has(key) || !Array.isArray(query.ids) || query.ids.some(id => !validId(id)) || new Set(query.ids).size !== query.ids.length) invalid('记录成员条件无效或重复。')
    queries.add(key)
    if (query.ids.length > MAX_RECORDS) throw new CanvasEditError('记录成员数量超过上限。', 'limit')
  }
  return records
}

// Only document values cross this seam; callers retain session intent separately.
export function captureRecordBasis(snapshot, dependencies) {
  const index = memberIndex(snapshot, dependencies.memberships)
  const basis = { version: 1, records: [...new Set(dependencies.ids)].sort().map(id => [id, structuredClone(snapshot.store[id] ?? null)]), memberships: dependencies.memberships.map(query => ({ ...query, ids: index.get(queryKey(query)) })) }
  checked(basis, dependencies)
  return basis
}
export function assertRecordBasis(snapshot, basis, dependencies) {
  const records = checked(basis, dependencies)
  for (const [id, before] of records) if (!isEqual(snapshot.store[id] ?? null, before)) conflict()
  const index = memberIndex(snapshot, basis.memberships)
  for (const query of basis.memberships) if (!isEqual(index.get(queryKey(query)), [...query.ids].sort())) conflict()
  const queries = new Set(basis.memberships.map(queryKey))
  if (dependencies.memberships.some(query => !queries.has(queryKey(query)))) invalid('记录前置条件缺少必要的成员集合。')
  if (dependencies.ids.some(id => !records.has(id))) invalid('记录前置条件缺少目标、祖先或相关资源。')
}
