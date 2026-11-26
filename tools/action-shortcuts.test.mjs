import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasShortcutBindings, matchingCanvasShortcuts } from '../engine/interaction/shortcuts.js'
import { normalizeInput } from '../engine/interaction/input.js'
import { selectionFixture, shape } from './selection-fixture.mjs'

test('实际委托使用的整张声明表：所有修饰、重复、阶段和临时手形/图片/组上下文至多一个拥有者', () => {
  const codes = { ',': 'Comma', '<': 'Comma', '.': 'Period', '>': 'Period', '=': 'Equal', '+': 'Equal', '-': 'Minus', '_': 'Minus', '[': 'BracketLeft', ']': 'BracketRight', ' ': 'Space' }
  const candidates = new Map()
  for (const binding of canvasShortcutBindings) for (const key of binding.keys) {
    const code = codes[key] || (key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key.startsWith('arrow') ? `Arrow${key.slice(5, 6).toUpperCase()}${key.slice(6)}` : key)
    candidates.set(`${key}/${code}`, { key, code })
    if (binding.alt === true) for (const code of binding.codes || []) candidates.set(`å/${code}`, { key: 'å', code })
  }
  const byId = new Map(canvasShortcutBindings.map(binding => [binding.id, binding]))
  const owner = binding => binding.aliasOf ? owner(byId.get(binding.aliasOf)) : binding.id
  let checked = 0
  for (const candidate of candidates.values()) for (let mask = 0; mask < 16; mask++) for (const phase of ['down', 'up']) for (const repeat of [false, true]) for (const temporaryTool of [null, 'hand']) for (const selectionType of [null, 'group', 'image']) for (const toolId of ['select', 'hand', 'draw']) {
    const input = normalizeInput({ ...candidate, type: `key_${phase}`, time: 1, repeat, metaKey: Boolean(mask & 1), ctrlKey: Boolean(mask & 2), altKey: Boolean(mask & 4), shiftKey: Boolean(mask & 8) })
    const context = { toolId, temporaryTool, selectionType, croppingId: null }
    const matches = matchingCanvasShortcuts(input, context)
    assert.ok(new Set(matches.map(owner)).size <= 1, JSON.stringify({ input, context, bindings: matches.map(b => b.id) }))
    checked++
  }
  assert.ok(checked > 10000)
})

test('已启动的裸逗号在修饰键变化后仍能松键提交；Shift逗号不会启动虚拟指针', async () => {
  const f = await selectionFixture([shape('a', 100, 100)])
  try {
    await f.click(120, 120)
    f.pointer('move', 130, 130, { buttons: 0 })
    f.input({ type: 'key_down', key: ',', code: 'Comma' })
    f.pointer('move', 160, 150)
    await f.input({ type: 'key_up', key: '<', code: 'Comma', shiftKey: true })
    assert.equal(f.commits.length, 1); assert.equal(f.session.store.get('shape:a').x, 130)
    await f.input({ type: 'key_down', key: '<', code: 'Comma', shiftKey: true })
    assert.equal(f.commits.length, 2); assert.equal(f.state().mode, 'idle'); assert.equal(f.session.state.get().isGestureActive, false)
  } finally { f.close() }
})
