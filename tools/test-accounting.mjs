import { relative, resolve } from 'node:path'

// 登记来源是 Node 的 test:enqueue，而非源码中 test() 的个数；循环和动态子测试同样计入。
// 最终汇总必须存在：若登记与结果的尾部一起被截断，仅比较两边个数仍会假绿。
export function createTestAccounting(expectedFiles) {
  const states = new Map(expectedFiles.map(file => [resolve(file), {
    registered: new Map(), completed: new Set(), summaries: [],
  }]))
  const errors = []
  const label = file => relative(process.cwd(), file) || file

  function accept({ type, data }) {
    // 没有 entryFile 的事件来自父运行器（包括文件包装测试），不能当作文件内部测试。
    if (!data.entryFile) return
    const file = resolve(data.entryFile), state = states.get(file)
    if (!state) {
      errors.push(`${label(file)}：收到未列入本次检查的文件事件。`)
      return
    }
    if (type === 'test:summary') {
      state.summaries.push(data)
      return
    }
    if (!['test:enqueue', 'test:pass', 'test:fail'].includes(type)) return
    const id = data.testId
    if (!Number.isInteger(id)) {
      errors.push(`${label(file)}：${type} 缺少 testId，不能核对测试身份。`)
      return
    }
    if (type === 'test:enqueue') {
      if (state.registered.has(id)) errors.push(`${label(file)}：重复登记测试 ${id}。`)
      state.registered.set(id, data.type)
    } else {
      if (!state.registered.has(id)) errors.push(`${label(file)}：完成事件对应未登记的测试 ${id}。`)
      if (state.completed.has(id)) errors.push(`${label(file)}：测试 ${id} 的完成事件重复。`)
      state.completed.add(id)
    }
  }

  function finish() {
    const files = []
    for (const [file, state] of states) {
      const { registered, completed, summaries } = state
      const missing = [...registered.keys()].filter(id => !completed.has(id)).length
      if (missing) errors.push(`${label(file)}：实际完成少 ${missing} 项（登记 ${registered.size}，完成 ${completed.size}）。`)
      if (summaries.length !== 1) errors.push(`${label(file)}：缺失或重复文件最终汇总（收到 ${summaries.length} 份）。`)
      const summary = summaries[0]
      const tests = [...registered.values()].filter(type => type === 'test').length
      const suites = [...registered.values()].filter(type => type === 'suite').length
      if (tests + suites !== registered.size) errors.push(`${label(file)}：出现无法识别的测试类型。`)
      if (summary) {
        if (summary.counts?.tests !== tests || summary.counts?.suites !== suites) {
          errors.push(`${label(file)}：最终汇总测试 ${summary.counts?.tests}、套件 ${summary.counts?.suites}，登记测试 ${tests}、套件 ${suites}，数量不符。`)
        }
        if (summary.success !== true) errors.push(`${label(file)}：文件最终汇总报告失败。`)
      }
      files.push({ file, registered: registered.size, completed: completed.size, tests, suites })
    }
    return { files, errors: [...new Set(errors)] }
  }
  return { accept, finish }
}
