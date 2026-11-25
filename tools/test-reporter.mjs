import { inspect } from 'node:util'
import { relative } from 'node:path'
import { createTestAccounting } from './test-accounting.mjs'

export default async function* report(source) {
  const files = JSON.parse(process.env.HICANVAS_TEST_ENTRY_FILES || '[]')
  if (!files.length) throw new Error('测试报告器缺少待核对文件清单；请用 node tools/run-tests.mjs。')
  const accounting = createTestAccounting(files)
  let finalSummary
  for await (const event of source) {
    accounting.accept(event)
    const { type, data } = event
    if (type === 'test:pass' || type === 'test:fail') {
      const passed = type === 'test:pass'
      yield `${passed ? '✔' : '✖'} ${data.name}${data.skip ? ' [跳过]' : ''}${data.todo ? ' [TODO]' : ''} (${data.details?.duration_ms ?? 0}ms)\n`
      if (!passed) yield `${inspect(data.details?.error, { depth: 6, colors: false })}\n`
    } else if (type === 'test:stdout' || type === 'test:stderr') {
      yield data.message
    } else if (type === 'test:summary' && !data.entryFile) {
      finalSummary = data
    }
  }
  const result = accounting.finish()
  if (!finalSummary) result.errors.push('缺少运行器最终汇总。')
  else if (!finalSummary.success) result.errors.push('运行器报告测试失败。')
  yield '\n逐文件测试数量核对（含跳过与 TODO，套件另计）：\n'
  for (const row of result.files) {
    yield `${relative(process.cwd(), row.file)}：登记 ${row.registered}，完成 ${row.completed}（测试 ${row.tests}，套件 ${row.suites}）\n`
  }
  if (result.errors.length) {
    process.exitCode = 1
    yield `测试数量核对失败：\n${result.errors.join('\n')}\n`
  } else {
    const total = result.files.reduce((sum, row) => sum + row.tests, 0)
    yield `测试数量核对通过：${result.files.length} 个文件，${total} 项测试。\n`
  }
}
