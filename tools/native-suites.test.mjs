import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { selectNativeSuite } from './renderer-preview/native-suites.mjs'
import { runNativeSuite } from './renderer-preview/native-suite-runner.mjs'

// The priority and report contracts below come from the pre-refactor entry,
// not from iterating the new registry and accepting whatever it contains.
const priority = ['shapeLinksOnly', 'embedsOnly', 'focusOnly', 'slidesOnly', 'framesOnly', 'imagesOnly', 'videosOnly', 'snappingOnly', 'notesOnly', 'connectionsOnly', 'textEditingOnly', 'actionsOnly', 'lasersOnly', 'erasersOnly', 'drawOnly', 'creationOnly', 'selectionSemanticsOnly', 'keyboardOnly', 'handlesOnly', 'contentFilmOnly', 'contentCaptureOnly', 'contentChannelOnly', 'contentSecurityOnly', 'cameraOnly', 'selectionOnly']
const legacy = new Set(['embedsOnly', 'imagesOnly', 'contentFilmOnly', 'contentCaptureOnly', 'contentChannelOnly', 'contentSecurityOnly', 'selectionOnly'])
const contracts = [
  ['resourceConflictsOnly', 'resource-conflicts', 'gallery=image-import&edgeScrolling=0&reduceMotion=1&resourceConflicts=1', [['resourceConflicts']]],
  ['shapeLinksOnly', 'shape-links', 'gallery=shape-links&edgeScrolling=0', [['shapeLinks']]],
  ['focusOnly', 'focus-keys', 'gallery=focus-keys&edgeScrolling=0', [['focus']], ['runtime', 'sourceHash']],
  ['slidesOnly', 'slides', 'gallery=slides&edgeScrolling=0', [['slides', 'guards']], ['runtime', 'sourceHash']],
  ['framesOnly', 'frames', 'gallery=frame-interaction&edgeScrolling=0', [['frames']]],
  ['videosOnly', 'videos', 'gallery=videos&edgeScrolling=0', [['videos'], ['mediaCleanup']]],
  ['snappingOnly', 'snapping', 'gallery=snapping&snapping=1&edgeScrolling=0', [['snapping']]],
  ['notesOnly', 'note-editing', 'gallery=note-editing&edgeScrolling=0', [['notes']]],
  ['connectionsOnly', 'connection-editing', 'gallery=connection-editing&edgeScrolling=0', [['connections']]],
  ['textEditingOnly', 'text-editing', 'gallery=text-editing&edgeScrolling=0', [['textEditing']]],
  ['actionsOnly', 'selection-actions', 'gallery=selection-actions&edgeScrolling=0&reduceMotion=1', [['actions'], ['duplicates']]],
  ['lasersOnly', 'laser', 'gallery=laser&edgeScrolling=0', [['laser']], ['runtime', 'sourceHash']],
  ['erasersOnly', 'eraser', 'gallery=eraser&edgeScrolling=0', [['eraser']]],
  ['drawOnly', 'draw-input', 'gallery=draw-input', [['draw']]],
  ['creationOnly', 'creation', 'gallery=creation&edgeScrolling=0', [['creation']]],
  ['selectionSemanticsOnly', 'selection-semantics', 'gallery=selection-semantics', [['selectionSemantics']]],
  ['keyboardOnly', 'keyboard', 'count=500', [['keyboard']]],
  ['handlesOnly', 'handles', 'count=500', [['handles', 'cameraLayout']]],
  ['cameraOnly', 'camera', 'count=500', [['camera']], []],
]

test('所有原入口保持一热分派；保留分支作为优先级锚点返回', () => {
  for (const flag of priority) {
    const selected = selectNativeSuite({ [flag]: true })
    assert.equal(selected?.flag, flag, flag)
    assert.equal(Boolean(selected.legacy), legacy.has(flag), flag)
  }
})

test('任意两个入口同时启用仍按原优先级，语义选择优先于键盘', () => {
  for (let first = 0; first < priority.length; first++) for (let next = first + 1; next < priority.length; next++) {
    const flags = [priority[first], priority[next]]
    assert.equal(selectNativeSuite(Object.fromEntries(flags.map(flag => [flag, true])))?.flag, flags[0], flags.join(' + '))
  }
})

test('不改truthy语义，空配置、未知入口及单独eraserColorOnly仍不分派', () => {
  for (const value of [1, 'yes', [], {}]) assert.equal(selectNativeSuite({ framesOnly: value })?.flag, 'framesOnly')
  for (const value of [false, 0, '', null, undefined]) assert.equal(selectNativeSuite({ framesOnly: value }), undefined)
  for (const manifest of [{}, { futureOnly: true }, { eraserColorOnly: true }]) assert.equal(selectNativeSuite(manifest), undefined)
})

test('入表项保留原窗口、URL、sample分组和成功报告附加字段', () => {
  for (const [flag, key, query, fields, report = ['runtime']] of contracts) {
    const suite = selectNativeSuite({ [flag]: true })
    assert.equal(suite.key, key, flag)
    assert.equal(suite.query, query, flag)
    assert.deepEqual(suite.samples.map(sample => Object.keys(sample)), fields, flag)
    assert.deepEqual(suite.report, report, flag)
  }
})

async function fixture(t, options = {}) {
  const base = resolve(import.meta.dirname, '../.scratch')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'native-suite-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const events = [], calls = [], samples = [], errors = [], blocked = []
  const manifest = { url: 'http://127.0.0.1:43397', output: directory, result: join(directory, 'result.json'), sourceHash: 'fixture-source', videoFiles: { file: 'synthetic.webm' } }
  const window = {
    async loadURL(url) { events.push(['load', url]); if (options.navigationError) throw options.navigationError },
    webContents: { async executeJavaScript() { events.push(['state']); return options.state || { ready: true } } },
    destroy() { events.push(['destroy']) },
  }
  const clipboard = { readText() { assert.fail('System clipboard must not be read by the runner') } }
  let currentWindow
  const context = {
    manifest, samples, errors, blocked, clipboard,
    createWindow(key) { events.push(['create', key]); currentWindow = window; return window },
    async cameraLayoutProbe(selected) { calls.push(selected); return { selected, cameraLayouts: 0 } },
  }
  const suite = { flag: 'fixtureOnly', key: 'fixture', query: 'gallery=fixture&edgeScrolling=0', samples: [{ sample: async () => ({ checks: 1 }) }], report: ['runtime'] }
  return { context, suite, window, events, calls, directory, current: () => currentWindow, report: async () => JSON.parse(await readFile(manifest.result, 'utf8')) }
}

test('没有登记或选中保留分支时不创建窗口、不写结果', async t => {
  const f = await fixture(t)
  for (const suite of [undefined, { flag: 'imagesOnly', legacy: true }]) assert.equal(await runNativeSuite(suite, f.context), false)
  assert.deepEqual(f.events, [])
  await assert.rejects(f.report, { code: 'ENOENT' })
})

test('先公布当前窗口、准备再导航；每个字段顺序await，每个完整sample立即保留', async t => {
  const f = await fixture(t), prepared = { negative: { main: 'blocked' } }
  f.suite.prepare = async context => {
    assert.equal(f.current(), f.window)
    assert.equal(context.window, f.window)
    assert.equal(context.clipboard, f.context.clipboard)
    f.events.push(['prepare'])
    return prepared
  }
  f.suite.samples = [
    { first: async context => {
      assert.equal(context.manifest, f.context.manifest)
      assert.equal(context.prepared, prepared)
      assert.equal(context.manifest.videoFiles, f.context.manifest.videoFiles)
      f.events.push(['first:start']); await Promise.resolve(); f.events.push(['first:end'])
      return { stage: 'first', checks: 2 }
    }, guards: async context => context.prepared.negative },
    { second: async () => {
      assert.deepEqual(f.context.samples, [{ first: { stage: 'first', checks: 2 }, guards: prepared.negative }])
      f.events.push(['second'])
      return { stage: 'second', checks: 3 }
    } },
  ]
  assert.equal(await runNativeSuite(f.suite, f.context), true)
  assert.deepEqual(f.events.map(event => event[0]), ['create', 'prepare', 'load', 'state', 'first:start', 'first:end', 'second'])
  assert.equal(f.events.find(event => event[0] === 'load')[1], `${f.context.manifest.url}/?${f.suite.query}`)
  const report = await f.report()
  assert.deepEqual(report.samples, f.context.samples)
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, [])
  assert.deepEqual(report.runtime, process.versions)
  assert.deepEqual(Object.keys(report).sort(), ['samples', 'errors', 'blocked', 'runtime'].sort())
})

test('camera报告不补runtime，带指纹的登记项回传当次sourceHash', async t => {
  const camera = await fixture(t)
  camera.suite.report = []
  await runNativeSuite(camera.suite, camera.context)
  assert.deepEqual(Object.keys(await camera.report()).sort(), ['samples', 'errors', 'blocked'].sort())
  const hashed = await fixture(t)
  hashed.suite.report = ['runtime', 'sourceHash']
  await runNativeSuite(hashed.suite, hashed.context)
  assert.equal((await hashed.report()).sourceHash, hashed.context.manifest.sourceHash)
})

test('同一sample内额外相机检查顺序执行，原字段仍在同一个对象中', async t => {
  const f = await fixture(t)
  f.suite.samples = [{ handles: async () => ({ undo: true }), cameraLayout: context => context.cameraLayoutProbe(true) }]
  await runNativeSuite(f.suite, f.context)
  assert.deepEqual((await f.report()).samples, [{ handles: { undo: true }, cameraLayout: { selected: true, cameraLayouts: 0 } }])
  assert.deepEqual(f.calls, [true])
})

test('第二sample失败时第一sample仍可取证，当前窗口不被提前销毁', async t => {
  const f = await fixture(t), failure = new Error('second-stage-failure')
  f.suite.samples = [{ first: async () => ({ checks: 2 }) }, { second: async () => { throw failure } }]
  await assert.rejects(() => runNativeSuite(f.suite, f.context), error => error === failure)
  assert.deepEqual(f.context.samples, [{ first: { checks: 2 } }])
  assert.equal(f.current(), f.window)
  assert.equal(f.events.some(event => event[0] === 'destroy'), false)
  await assert.rejects(f.report, { code: 'ENOENT' })
})

test('同一sample第二字段失败时不push半个对象，保持原求值语义', async t => {
  const f = await fixture(t), failure = new Error('second-field-failure')
  f.suite.samples = [{ first: async () => ({ checks: 1 }), second: async () => { throw failure } }]
  await assert.rejects(() => runNativeSuite(f.suite, f.context), error => error === failure)
  assert.deepEqual(f.context.samples, [])
  assert.equal(f.current(), f.window)
  await assert.rejects(f.report, { code: 'ENOENT' })
})

test('prepare失败不继续导航，也不把失败窗口提前销毁', async t => {
  const f = await fixture(t), failure = new Error('prepare-failure')
  f.suite.prepare = async () => { throw failure }
  await assert.rejects(() => runNativeSuite(f.suite, f.context), error => error === failure)
  assert.deepEqual(f.events, [['create', 'fixture']])
  assert.equal(f.current(), f.window)
})

test('导航或ready报告错误时原错误向外传播，不开始专项、不写成功结果', async t => {
  for (const options of [{ navigationError: new Error('navigation-failure') }, { state: { error: 'readiness-failure' } }]) {
    const f = await fixture(t, options)
    f.suite.samples = [{ shouldNotRun: async () => assert.fail('Check ran before ready') }]
    await assert.rejects(() => runNativeSuite(f.suite, f.context), options.navigationError ? error => error === options.navigationError : /readiness-failure/)
    assert.deepEqual(f.context.samples, [])
    assert.equal(f.events.some(event => event[0] === 'destroy'), false)
    await assert.rejects(f.report, { code: 'ENOENT' })
  }
})

test('控制台错误与外部拦截都拒绝写成功结果，已完成sample仍保留', async t => {
  for (const field of ['errors', 'blocked']) {
    const f = await fixture(t)
    f.suite.samples = [{ sample: async () => { f.context[field].push('unexpected-effect'); return { checks: 1 } } }]
    await assert.rejects(() => runNativeSuite(f.suite, f.context), /unexpected-effect/)
    assert.deepEqual(f.context.samples, [{ sample: { checks: 1 } }])
    await assert.rejects(f.report, { code: 'ENOENT' })
  }
})

test('专项准备守卫的calls有记录时继续拒绝，不能只核errors和blocked', async t => {
  const f = await fixture(t)
  f.suite.prepare = async () => ({ calls: ['forbidden-call'] })
  f.suite.guardCalls = context => context.prepared.calls
  await assert.rejects(() => runNativeSuite(f.suite, f.context), /forbidden-call/)
  assert.deepEqual(f.context.samples, [{ sample: { checks: 1 } }])
  await assert.rejects(f.report, { code: 'ENOENT' })
})

test('结果落盘失败不吞错、不清空部分证据或提前关闭失败截图窗口', async t => {
  const f = await fixture(t)
  f.context.manifest.result = join(f.directory, 'missing-parent', 'result.json')
  await assert.rejects(() => runNativeSuite(f.suite, f.context), { code: 'ENOENT' })
  assert.deepEqual(f.context.samples, [{ sample: { checks: 1 } }])
  assert.equal(f.current(), f.window)
  assert.equal(f.events.some(event => event[0] === 'destroy'), false)
})

test('shapeLinksOnly接入真实开窗准备，优先于embeds并保留报告身份前缀', () => {
  const selected = selectNativeSuite({ shapeLinksOnly: true, embedsOnly: true })
  assert.equal(selected.flag, 'shapeLinksOnly')
  assert.equal(typeof selected.open, 'function')
  assert.deepEqual(selected.reportBefore, ['pid', 'fingerprint'])
  assert.equal(selected.guardKey, 'native')
})

test('资源冲突专项独立入表、懒加载，并先准备原生守卫再建首窗', async () => {
  const selected = selectNativeSuite({ resourceConflictsOnly: true, recordConflictsOnly: true, shapeLinksOnly: true })
  assert.equal(selected.flag, 'resourceConflictsOnly')
  assert.equal(typeof selected.open, 'function'); assert.equal(selected.prepare, undefined)
  assert.deepEqual(selected.reportBefore, ['pid', 'fingerprint']); assert.equal(selected.guardKey, 'native')
  const source = await readFile(new URL('./renderer-preview/native-suites.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^import .*resource-conflicts-smoke/m)
  const probe = await readFile(new URL('./renderer-preview/resource-conflicts-smoke.mjs', import.meta.url), 'utf8')
  assert.match(probe, /return prepareShapeLinksProbe\(context\)/)
})

test('特殊open先装守卫再建首窗，准备结果交给原sample，不能重复开窗或准备', async t => {
  const f = await fixture(t), prepared = { blocked: [] }
  f.suite.open = async context => {
    assert.equal(f.current(), undefined)
    f.events.push(['guards'])
    return { window: context.createWindow('shape-links'), prepared }
  }
  f.suite.prepare = async () => assert.fail('Ordinary preparation must not run again')
  f.suite.samples = [{ shapeLinks: async context => {
    assert.equal(context.window, f.window); assert.equal(context.prepared, prepared)
    assert.equal(context.errors, f.context.errors)
    return { guardsBeforeWindow: true }
  } }]
  await runNativeSuite(f.suite, f.context)
  assert.deepEqual(f.events.map(event => event[0]), ['guards', 'create', 'load', 'state'])
  assert.deepEqual(f.context.samples, [{ shapeLinks: { guardsBeforeWindow: true } }])
})

test('特殊open建窗后失败也保留当前取证窗口，不导航或写成功报告', async t => {
  const f = await fixture(t), failure = new Error('open-proof-failed')
  f.suite.open = async context => { context.createWindow('shape-links'); throw failure }
  await assert.rejects(() => runNativeSuite(f.suite, f.context), error => error === failure)
  assert.equal(f.current(), f.window)
  assert.deepEqual(f.events, [['create', 'shape-links']])
  assert.deepEqual(f.context.samples, [])
  await assert.rejects(f.report, { code: 'ENOENT' })
})

test('报告保留pid/fingerprint原前缀及实际进程身份，native守卫非空仍拒绝', async t => {
  const f = await fixture(t)
  f.context.manifest.fingerprint = 'actual-source-identity'
  f.suite.reportBefore = ['pid', 'fingerprint']
  await runNativeSuite(f.suite, f.context)
  const report = await f.report()
  assert.deepEqual(Object.keys(report), ['pid', 'fingerprint', 'samples', 'errors', 'blocked', 'runtime'])
  assert.equal(report.pid, process.pid)
  assert.equal(report.fingerprint, 'actual-source-identity')
  const denied = await fixture(t)
  denied.suite.open = async context => ({ window: context.createWindow('shape-links'), prepared: { blocked: ['native-forbidden'] } })
  denied.suite.guardKey = 'native'
  denied.suite.guardCalls = context => context.prepared.blocked
  await assert.rejects(() => runNativeSuite(denied.suite, denied.context), error => {
    assert.deepEqual(JSON.parse(error.message), { errors: [], blocked: [], native: ['native-forbidden'] })
    return true
  })
  assert.deepEqual(denied.context.samples, [{ sample: { checks: 1 } }])
  await assert.rejects(denied.report, { code: 'ENOENT' })
})

test('Gist扩展只在embeds登记，原特殊入口报告保持；其他组没有可选HTTPS适配器', () => {
  const embeds = selectNativeSuite({ embedsOnly: true })
  assert.equal(embeds.legacy, true)
  assert.equal(typeof embeds.windowAdapter, 'function')
  assert.equal(typeof embeds.gist, 'function')
  for (const flag of priority.filter(flag => flag !== 'embedsOnly')) {
    const entry = selectNativeSuite({ [flag]: true })
    assert.equal(entry.windowAdapter, undefined, flag)
    assert.equal(entry.gist, undefined, flag)
  }
  const handlers = []
  const session = { protocol: { handle: (...args) => handlers.push(args) } }
  assert.equal(embeds.windowAdapter({ key: 'external', manifest: { embedsOnly: true }, session }), null)
  assert.equal(embeds.windowAdapter({ key: 'gist-security', manifest: {}, session }), null)
  assert.equal(handlers.length, 0)
  const adapter = embeds.windowAdapter({ key: 'gist-security', manifest: { embedsOnly: true }, session })
  assert.ok(adapter); assert.equal(handlers.length, 1); adapter.dispose()
})

test('所有原生专项均保持离屏隐藏视图与相同沙箱权限', async () => {
  const source = await readFile(new URL('./renderer-preview/electron.mjs', import.meta.url), 'utf8')
  const factory = source.slice(source.indexOf('function createWindow('), source.indexOf('\nasync function run()'))
  const stop = new Error('captured constructor options')
  let captured
  const createWindow = runInNewContext('(' + factory + ')', { process: { pid: 1 }, BrowserWindow: class { constructor(options) { captured = options; throw stop } } })
  for (const key of [...priority, 'embed-editing', 'external', 'gist-security']) {
    assert.throws(() => createWindow(key), error => error === stop)
    assert.equal(captured.show, false, key)
    assert.equal(captured.webPreferences.offscreen, true, key)
    assert.equal(captured.webPreferences.sandbox, true, key)
    assert.equal(captured.webPreferences.contextIsolation, true, key)
    assert.equal(captured.webPreferences.nodeIntegration, false, key)
  }
})
