import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { createTestAccounting } from './test-accounting.mjs'

const file = resolve('server/example.test.mjs')
const event = (type, data) => ({ type, data: { entryFile: file, file, ...data } })
function stream() {
  return [
    event('test:enqueue', { testId: 1, type: 'test', name: 'first' }),
    event('test:enqueue', { testId: 2, type: 'test', name: 'second' }),
    event('test:pass', { testId: 1, details: { type: 'test' } }),
    event('test:pass', { testId: 2, details: { type: 'test' } }),
    event('test:summary', { success: true, counts: { tests: 2, suites: 0 } }),
  ]
}
function check(events, files = [file]) {
  const accounting = createTestAccounting(files)
  events.forEach(accounting.accept)
  return accounting.finish()
}

test('完整的登记、完成与文件汇总按文件核对', () => {
  const result = check(stream())
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.files, [{ file, registered: 2, completed: 2, tests: 2, suites: 0 }])
})

test('人为丢弃一个完成事件：明确报出文件和缺少1项', () => {
  const result = check(stream().filter(e => !(e.type === 'test:pass' && e.data.testId === 2)))
  assert.match(result.errors.join('\n'), /example\.test\.mjs.*少 1 项/)
})

test('登记与完成一起丢失也不能骗过文件最终汇总', () => {
  assert.match(check(stream().filter(e => e.data.testId !== 2)).errors.join('\n'), /汇总.*2.*登记.*1/)
})

test('整份文件没有事件或尾部汇总丢失都必须报红', () => {
  assert.match(check([]).errors.join('\n'), /example\.test\.mjs.*最终汇总/)
  assert.match(check(stream().slice(0, -1)).errors.join('\n'), /最终汇总/)
})

test('同名测试、套件、动态子测试与跳过项不会错算', () => {
  const events = [
    event('test:enqueue', { testId: 1, type: 'suite', name: 'suite' }),
    ...[2, 3, 4].map(testId => event('test:enqueue', { testId, type: 'test', name: 'same' })),
    event('test:pass', { testId: 1, details: { type: 'suite' } }),
    ...[2, 3, 4].map(testId => event('test:pass', { testId, details: { type: 'test' }, ...(testId === 4 ? { skip: true } : {}) })),
    event('test:summary', { success: true, counts: { tests: 3, suites: 1 } }),
  ]
  assert.deepEqual(check(events).errors, [])
  assert.equal(check(events).files[0].registered, 4)
})

test('未登记或重复的完成事件不能补足缺少的测试', () => {
  const events = stream().filter(e => !(e.type === 'test:pass' && e.data.testId === 2))
  events.splice(3, 0, event('test:pass', { testId: 1, details: { type: 'test' } }))
  assert.match(check(events).errors.join('\n'), /重复/)
  events[3] = event('test:pass', { testId: 99, details: { type: 'test' } })
  assert.match(check(events).errors.join('\n'), /未登记/)
})

test('多个文件的testId各自独立，意外文件和失败汇总不能报绿', () => {
  const second = resolve('tools/other.test.mjs')
  const events = stream().concat(stream().map(e => ({ ...e, data: { ...e.data, file: second, entryFile: second } })))
  assert.deepEqual(check(events, [file, second]).errors, [])
  assert.match(check(events).errors.join('\n'), /未列入/)
  const failed = stream()
  failed.at(-1).data.success = false
  assert.match(check(failed).errors.join('\n'), /失败/)
})
