// 与事务上限无关，只为不依赖上限的具体数值；即使上限提高也保持小批预置。
export const fixtureBatchSize = 500

export async function prepareFixture(workspace, id, current, snapshot) {
  const records = [], visited = new Set(), visiting = new Set()
  function visit(record) {
    if (!record || visited.has(record.id)) return
    if (visiting.has(record.id)) throw new Error('合成画板记录存在循环引用。')
    visiting.add(record.id)
    // 每批结束都会校验关系，引用的记录必须在同批或更早的批次里。
    for (const dependency of [record.parentId, record.props?.assetId, record.fromId, record.toId]) visit(snapshot.store[dependency])
    visiting.delete(record.id)
    visited.add(record.id)
    records.push(record)
  }
  Object.values(snapshot.store).forEach(visit)
  let result = current
  for (let offset = 0; offset < records.length; offset += fixtureBatchSize) {
    const commands = records.slice(offset, offset + fixtureBatchSize).map(record => ({ type: 'put', record }))
    result = await workspace.submitCommands(id, result.revision, 'perf-fixture', () => commands)
  }
  return result
}
