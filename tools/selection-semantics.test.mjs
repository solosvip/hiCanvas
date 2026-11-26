import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionFixture, shape } from './selection-fixture.mjs'

const group = (id, ids) => ({ type: 'group_shapes', groupId: `shape:${id}`, ids: ids.map(id => `shape:${id}`) })
const groups = [shape('a', 100, 100), shape('b', 300, 100), shape('e', 600, 300), shape('f', 760, 300), shape('h', 600, 500), shape('i', 760, 500), group('inner', ['h', 'i']), group('outer', ['e', 'f', 'inner'])]

test('组内全选、进入和退出一层、父子导航共用当前组；无文档和撤销记录', async () => {
  const f = await selectionFixture(groups)
  try {
    await f.click(620, 320)
    f.interaction.select('enter')
    assert.equal(f.state().focusedGroupId, 'shape:outer')
    assert.deepEqual(f.selected(), ['shape:e', 'shape:f', 'shape:inner'])
    f.interaction.select('parent')
    assert.deepEqual(f.selected(), ['shape:outer'])
    assert.equal(f.state().focusedGroupId, 'page:page')
    f.interaction.select('child')
    assert.equal(f.state().focusedGroupId, 'shape:outer')
    assert.deepEqual(f.selected(), ['shape:e'])
    f.interaction.select('all')
    assert.deepEqual(f.selected(), ['shape:e', 'shape:f', 'shape:inner'])
    f.interaction.select('clear')
    assert.deepEqual(f.selected(), ['shape:outer'])
    f.interaction.select('clear')
    assert.deepEqual(f.selected(), [])
    assert.equal(f.commits.length, 0)
    assert.deepEqual(f.current(), f.initial)
    assert.equal(f.session.state.get().revision, '0')
  } finally { f.close() }
})

test('框选不越出当前组；空白单击才退出；点外部形状回到公共组', async () => {
  const f = await selectionFixture(groups)
  try {
    await f.click(620, 320); f.interaction.select('enter')
    f.pointer('down', 50, 50); f.pointer('move', 710, 420)
    assert.deepEqual(f.selected(), ['shape:e'])
    assert.equal(f.state().focusedGroupId, 'shape:outer')
    await f.pointer('up', 710, 420)
    await f.click(120, 120)
    assert.equal(f.state().focusedGroupId, 'page:page')
    assert.deepEqual(f.selected(), ['shape:a'])
    await f.click(620, 320); f.interaction.select('enter')
    await f.click(710, 410)
    assert.equal(f.state().focusedGroupId, 'page:page')
    assert.deepEqual(f.selected(), [])
  } finally { f.close() }
})

test('相交和完全包含偏好由 Control 临时反转；帧内外逐次更新并不保存', async () => {
  const f = await selectionFixture()
  try {
    f.pointer('down', 50, 50); f.pointer('move', 120, 120)
    assert.deepEqual(f.selected(), ['shape:a'])
    f.pointer('move', 121, 121, { ctrlKey: true }); assert.deepEqual(f.selected(), [])
    f.pointer('move', 122, 122); assert.deepEqual(f.selected(), ['shape:a'])
    f.pointer('cancel', 122, 122)
    f.interaction.setWrapMode(true)
    f.pointer('down', 50, 50); f.pointer('move', 120, 120)
    assert.deepEqual(f.selected(), [])
    f.pointer('move', 121, 121, { ctrlKey: true }); assert.deepEqual(f.selected(), ['shape:a'])
    f.pointer('move', 200, 200); assert.deepEqual(f.selected(), ['shape:a'])
    await f.pointer('up', 200, 200)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('读取顺序按重叠行排序并循环；空间相邻按方向半平面最近中心；首次选择移入视口', async () => {
  const f = await selectionFixture([shape('a', 100, 100), shape('b', 300, 100), shape('c', 200, 220), shape('d', 100, 400)])
  try {
    f.interaction.select('first'); assert.deepEqual(f.selected(), ['shape:a'])
    f.interaction.select('right'); assert.deepEqual(f.selected(), ['shape:c'])
    f.interaction.select('up'); assert.deepEqual(f.selected(), ['shape:a'])
    f.interaction.select('left'); assert.deepEqual(f.selected(), ['shape:a'])
    for (const id of ['b', 'c', 'd', 'a']) { f.interaction.select('next'); assert.deepEqual(f.selected(), [`shape:${id}`]) }
    f.interaction.select('previous'); assert.deepEqual(f.selected(), ['shape:d'])
    f.interaction.setCamera({ x: -10000, y: -10000, z: 1 })
    f.interaction.select('first')
    assert.deepEqual(f.state().camera, { x: 156, y: 156, z: 1 })
    f.interaction.select('first'); assert.deepEqual(f.state().camera, { x: 156, y: 156, z: 1 })
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('增量关系索引：移动、移出组、锁定和删除组后不保留失效成员，不读取全量快照', async () => {
  const f = await selectionFixture(groups)
  try {
    await f.click(620, 320); f.interaction.select('enter')
    await f.remote([{ type: 'update', id: 'shape:e', changes: { parentId: 'page:page', x: 50, y: 50 } }, { type: 'update', id: 'shape:f', changes: { isLocked: true } }])
    const all = f.session.store.allRecords, snapshot = f.session.store.getStoreSnapshot
    f.session.store.allRecords = () => { throw new Error('不应全表扫描') }
    f.session.store.getStoreSnapshot = () => { throw new Error('不应取整份快照') }
    f.interaction.select('all'); assert.deepEqual(f.selected(), ['shape:inner'])
    f.session.store.allRecords = all; f.session.store.getStoreSnapshot = snapshot
    await f.remote([{ type: 'ungroup_shapes', ids: ['shape:outer'] }])
    assert.equal(f.state().focusedGroupId, 'page:page')
    f.interaction.select('all')
    assert.ok(f.selected().includes('shape:e'))
    assert.ok(!f.selected().includes('shape:f'))
  } finally { f.close() }
})

test('双击组进入一层并点选所在子形状；嵌套组再进入和退出仍保持层级', async () => {
  const f = await selectionFixture(groups)
  try {
    await f.click(620, 320)
    await f.doubleClick(620, 320)
    assert.equal(f.state().focusedGroupId, 'shape:outer'); assert.deepEqual(f.selected(), ['shape:e'])
    await f.click(620, 520)
    assert.deepEqual(f.selected(), ['shape:inner'])
    f.interaction.select('enter')
    assert.equal(f.state().focusedGroupId, 'shape:inner'); assert.deepEqual(f.selected(), ['shape:h', 'shape:i'])
    f.interaction.select('clear')
    assert.equal(f.state().focusedGroupId, 'shape:outer'); assert.deepEqual(f.selected(), ['shape:inner'])
    f.interaction.select('clear')
    assert.equal(f.state().focusedGroupId, 'page:page'); assert.deepEqual(f.selected(), ['shape:outer'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('父子选择包括画框，但画框不充当当前组；全选只选当前页的直接成员', async () => {
  const f = await selectionFixture([shape('frame', 500, 100, { shapeType: 'frame', props: { w: 300, h: 300 } }), shape('child', 20, 20, { parentId: 'shape:frame' }), shape('other', 100, 100), shape('locked', 100, 400), shape('hidden', 300, 400), { type: 'update', id: 'shape:locked', changes: { isLocked: true } }, { type: 'update', id: 'shape:hidden', changes: { opacity: 0 } }])
  try {
    await f.click(540, 140); assert.deepEqual(f.selected(), ['shape:child'])
    f.interaction.select('parent'); assert.deepEqual(f.selected(), ['shape:frame'])
    f.interaction.select('child'); assert.deepEqual(f.selected(), ['shape:child'])
    assert.equal(f.state().focusedGroupId, 'page:page')
    f.interaction.select('all'); assert.deepEqual(f.selected(), ['shape:frame', 'shape:other'])
  } finally { f.close() }
})

test('跨行高形状让阅读顺序形成连续重叠行，按 x 再 y 排序', async () => {
  const f = await selectionFixture([shape('a', 100, 150, { props: { w: 100, h: 100 } }), shape('b', 250, 100, { props: { w: 100, h: 100 } }), shape('c', 100, 300, { props: { w: 100, h: 100 } }), shape('d', 400, 100, { props: { w: 100, h: 350 } })])
  try {
    f.interaction.select('first')
    for (const id of ['c', 'b', 'd', 'a']) { f.interaction.select('next'); assert.deepEqual(f.selected(), [`shape:${id}`]) }
  } finally { f.close() }
})

for (const [x, y] of [[500, 500], [-500, -500], [500, -500], [-500, 500]]) test(`极小视口找回屏外 (${x},${y})，保留比例且对象可见`, async () => {
  const f = await selectionFixture([shape('a', x, y)], { viewport: { w: 200, h: 200 }, camera: { x: 0, y: 0, z: 2 } })
  try {
    f.interaction.select('first')
    const camera = f.state().camera, left = (x + camera.x) * camera.z, top = (y + camera.y) * camera.z
    assert.equal(camera.z, 2); assert.ok(left >= 0 && left + 160 <= 200); assert.ok(top >= 0 && top + 120 <= 200)
  } finally { f.close() }
})

test('组拖动往返后的一次点击不被算成双击，拖动不净变化时也重置连击', async () => {
  const f = await selectionFixture(groups)
  try {
    f.pointer('down', 620, 320); f.pointer('move', 640, 340); f.pointer('move', 620, 320); await f.pointer('up', 620, 320)
    f.pointer('down', 620, 320); await f.pointer('up', 620, 320)
    assert.equal(f.state().focusedGroupId, 'page:page'); assert.deepEqual(f.selected(), ['shape:outer'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
