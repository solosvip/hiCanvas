import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hicanvas-gate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return (name, content) => {
    const file = join(dir, name)
    writeFileSync(file, content)
    return file
  }
}
function run(args, options = {}) {
  const env = { ...process.env, ...options.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 8000, maxBuffer: 5000000 })
  assert.ifError(result.error)
  return result
}
const entry = resolve('tools/run-tests.mjs')
const sandbox = resolve('tools/test-sandbox.mjs')
const preload = resolve('tools/test-report-preload.mjs')
const reporter = pathToFileURL(resolve('tools/test-reporter.mjs')).href

test('强制退出时长报告完整送达：2项实际执行与报告相符，连续5轮', t => {
  const make = fixture(t), marker = make('ran.txt', '')
  const file = make('long.mjs', `
    import test from 'node:test'
    import { appendFileSync } from 'node:fs'
    for(let i=0;i<2;i++) test('case '+i+'，'.repeat(10000),()=>appendFileSync(${JSON.stringify(marker)},'x'))
    setInterval(()=>{},1000) // 保留现有强制结束能力，不因悬挂句柄永远不退出。
  `)
  for (let i = 0; i < 5; i++) {
    writeFileSync(marker, '')
    const result = run(['--import', sandbox, '--import', preload, '--test', '--test-force-exit', '--test-reporter=tap', file])
    assert.equal(result.status, 0, result.stdout.slice(-3000) + result.stderr)
    assert.equal(readFileSync(marker, 'utf8'), 'xx')
    assert.equal((result.stdout.match(/^ok \d+ /gm) || []).length, 2, '强制退出不能丢掉已经执行的测试结果')
  }
  const result = run([entry, file])
  assert.equal(result.status, 0, result.stdout.slice(-3000) + result.stderr)
  assert.match(result.stdout, /登记 2，完成 2/)
  assert.match(result.stdout, /1 个文件，2 项测试/)
})

test('真实报告管线人为丢掉1个完成事件：即使Node结果成功也非零退出', t => {
  const make = fixture(t)
  const file = make('lost.mjs', `import test from 'node:test'; test('first',()=>{}); test('second',()=>{})`)
  const dropReporter = make('drop.mjs', `
    import report from ${JSON.stringify(reporter)}
    async function* drop(source) { for await(const event of source) {
      if(event.type==='test:pass' && event.data.entryFile && event.data.name==='second') continue
      yield event
    }}
    export default source => report(drop(source))
  `)
  const result = run(['--import', sandbox, '--import', preload, '--test', '--test-force-exit', `--test-reporter=${dropReporter}`, file], {
    env: { HICANVAS_TEST_ENTRY_FILES: JSON.stringify([file]) },
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /lost\.mjs.*少 1 项/)
  assert.match(result.stdout, /测试数量核对失败/)
})

test('测试文件主动exit(0)丢掉尾部：缺少文件汇总仍然报红', t => {
  const make = fixture(t)
  const file = make('early.mjs', `import test from 'node:test'; test('never',()=>{}); process.exit(0)`)
  const result = run([entry, file])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /early\.mjs.*最终汇总/)
})

test('导入的测试归到入口文件，套件、子测试和跳过计数一致', t => {
  const make = fixture(t)
  const helper = make('helper.mjs', `import test from 'node:test'; test('imported',()=>{})`)
  const file = make('nested.mjs', `
    import ${JSON.stringify(pathToFileURL(helper).href)}
    import test, { describe, it } from 'node:test'
    describe('suite',()=>{it('same',()=>{});it.skip('same',()=>{})})
    test('outer',async t=>{await t.test('inner',()=>{})})
  `)
  const result = run([entry, file])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /登记 6，完成 6（测试 5，套件 1）/)
})

test('空文件不能代替测试执行，真实断言失败仍非零退出', t => {
  const make = fixture(t)
  const empty = make('empty.mjs', '')
  const good = run([entry, empty])
  assert.equal(good.status, 1, good.stdout + good.stderr)
  assert.match(good.stdout, /empty\.mjs.*最终汇总/)
  const failed = make('failed.mjs', `import test from 'node:test'; test('broken',()=>{throw Error('expected failure')})`)
  const bad = run([entry, failed])
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stdout, /expected failure/)
  assert.match(bad.stdout, /最终汇总报告失败/)
})
