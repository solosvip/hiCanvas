import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkRestrictedImports, moduleReferences } from './restricted-imports.mjs'

const oldUi = "import { Box, useEditor } from 'tldraw'\nimport 'tldraw/tldraw.css'"
const baseline = { 'src/App.jsx': moduleReferences('src/App.jsx', oldUi).map(r => r.key) }
const check = (files, allowed = baseline, options) => checkRestrictedImports(new Map(Object.entries(files)), allowed, options)

test('界面继承引用可保留、减少；不能新增文件、导出符号或重复引用', () => {
  assert.deepEqual(check({ 'src/App.jsx': oldUi }), [])
  assert.deepEqual(check({ 'src/App.jsx': "import { Box } from 'tldraw'" }), [])
  for (const source of [oldUi + "\nimport { Vec } from 'tldraw'", oldUi + "\nimport { Box as B } from 'tldraw'"]) {
    assert.match(check({ 'src/App.jsx': source }).join('\n'), /新增受限引用/)
  }
  assert.match(check({ 'src/New.jsx': oldUi }).join('\n'), /新增受限引用/)
})

test('服务端、MCP、桌面及入口和测试不接受任何受限引用，即使写进基线', () => {
  for (const path of ['server/a.mjs', 'server/a.test.mjs', 'mcp/a.mjs', 'desktop/a.cjs', 'bin/a.mjs', 'tools/a.test.mjs']) {
    assert.match(check({ [path]: oldUi }, { [path]: baseline['src/App.jsx'] }).join('\n'), /受限引用/)
  }
})

test('识别静态导入、再导出、动态导入、require、子路径、CSS 和未确认许可的包', () => {
  for (const [path, source] of [
    ['src/a.js', "export { Box } from '@tldraw/editor'"],
    ['src/a.js', "export * from 'tldraw'"],
    ['src/a.js', "const m = import('@tldraw/editor')"],
    ['src/a.js', "const m = import(`@tldraw/editor`)"],
    ['src/a.cjs', "const m = require('tldraw')"],
    ['src/a.cjs', "const m = require('tl' + 'draw')"],
    ['src/a.js', "const m = require.resolve('@tldraw/assets/fonts')"],
    ['src/a.ts', "import type { Editor } from '@tldraw/editor'"],
    ['src/a.cts', "import editor = require('@tldraw/editor')"],
    ['src/a.ts', "type Editor = import('@tldraw/editor').Editor"],
    ['src/a.js', "import '@tldraw/driver'"],
    ['src/a.css', '@import "tldraw/tldraw.css";'],
    ['src/a.css', '@import url("@tldraw/assets/styles.css");'],
    ['src/a.css', '@import url(tldraw/tldraw.css);'],
  ]) assert.match(check({ [path]: source }).join('\n'), /新增受限引用/, source)
})

test('MIT 数据包不受禁用限制，注释与普通文案不算导入', () => {
  const source = "import { Store } from '@tldraw/store'; import { toRichText } from '@tldraw/tlschema'; import { getIndexAbove } from '@tldraw/utils'; // import 'tldraw'\nconst text = \"require('tldraw')\""
  assert.deepEqual(check({ 'server/a.mjs': source }), [])
})

test('导入的本地别名不改变继承额度', () => {
  const source = "import OldName, * as Previous from 'tldraw'"
  const allowance = { 'src/a.js': moduleReferences('src/a.js', source).map(r => r.key) }
  assert.deepEqual(check({ 'src/a.js': "import NewName, * as Current from 'tldraw'" }, allowance), [])
})

test('服务端不能通过本地共享模块间接依赖受限包，允许有环的纯数据模块', () => {
  const files = { 'server/a.mjs': "import '../src/bridge.js'", 'src/bridge.js': "export * from './App.jsx'", 'src/App.jsx': oldUi }
  assert.match(check(files).join('\n'), /server\/a.mjs.*间接.*src\/App.jsx/)
  assert.deepEqual(check({ 'server/a.mjs': "import './b.mjs'", 'server/b.mjs': "import './a.mjs'; import '@tldraw/tlschema'" }), [])
})

test('基线不能扩张，已删掉的引用不能借旧基线重新加入', () => {
  const expanded = { ...baseline, 'src/New.jsx': baseline['src/App.jsx'] }
  assert.match(check({}, expanded, { previousBaseline: baseline }).join('\n'), /基线.*增加/)
  assert.match(check({ 'src/App.jsx': oldUi }, baseline, { previousFiles: new Map([['src/App.jsx', "import { Box } from 'tldraw'"]]) }).join('\n'), /已移除.*重新/)
})

test('动态目标和 createRequire 别名不能绕过检查；路径查询和片段仍追踪本地模块', () => {
  for (const source of [
    "const name = 'tldraw'; await import(name)",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('tldraw')",
    "import { createRequire as factory } from 'node:module'; const load = factory(import.meta.url); load('@tldraw/editor')",
    "import * as module from 'node:module'; const load = module.createRequire(import.meta.url); load('tldraw')",
    "const load = require; load('@tldraw/assets')",
    "const { createRequire: makeRequire } = require('node:module'); const load = makeRequire(__filename); load('tldraw')",
    "const name = process.env.PACKAGE; require(name)",
  ]) assert.ok(check({ 'server/dynamic.mjs': source }).length > 0, source)
  for (const suffix of ['?compat', '#compat', '?compat#version']) {
    assert.match(check({ 'server/read.mjs': `import '../src/App.jsx${suffix}'`, 'src/App.jsx': oldUi }).join('\n'), /server\/read.mjs.*间接/)
  }
  assert.deepEqual(check({ 'server/path.mjs': "import { resolve } from 'node:path'; const path = resolve(process.cwd(), 'x')" }), [])
})
