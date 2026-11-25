import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const entry of ['createCanvasSnapshot', 'sanitizeCanvasSnapshot']) {
  test(`开发模式下 ${entry} 交出可修改的独立快照，含嵌套 meta 和 props`, () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict'
      import { readFileSync } from 'node:fs'
      import { createCanvasSnapshot, sanitizeCanvasSnapshot } from './model/index.js'
      ${entry === 'createCanvasSnapshot' ? `
        const initial = createCanvasSnapshot()
        initial.store['page:page'].name = '新建后可命名'
        assert.equal(initial.store['page:page'].name, '新建后可命名')
      ` : ''}
      const input = JSON.parse(readFileSync('./server/fixtures/legacy-canvas.json', 'utf8'))
      input.store['shape:geo'].meta.mutableProbe = { count: 1 }
      const before = structuredClone(input)
      const created = ${entry}(input)
      const snapshot = ${entry === 'sanitizeCanvasSnapshot' ? 'created.snapshot' : 'created'}
      ${entry === 'sanitizeCanvasSnapshot' ? 'assert.deepEqual(created.skippedRecords, [])' : ''}
      assert.deepEqual(snapshot, before, '交出数据前不得改变快照内容或 schema')
      snapshot.store['page:page'].name = '改名'
      snapshot.store['shape:geo'].meta.mutableProbe.count = 2
      snapshot.store['shape:geo'].props.w = 321
      snapshot.store['shape:geo'].props.richText.content[0].content[0].text = '修改嵌套文字'
      assert.equal(snapshot.store['page:page'].name, '改名')
      assert.equal(snapshot.store['shape:geo'].meta.mutableProbe.count, 2)
      assert.equal(snapshot.store['shape:geo'].props.w, 321)
      assert.equal(snapshot.store['shape:geo'].props.richText.content[0].content[0].text, '修改嵌套文字')
      assert.deepEqual(input, before, '修改输出不能回写输入或存储记录')
      console.log('mutable snapshot verified')
    `], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, NODE_ENV: 'development' },
      encoding: 'utf8', timeout: 5000,
    })
    assert.match(output, /mutable snapshot verified/)
  })
}
