import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverSkillDirectory } from '../desktop/skill-discovery.mjs'
import { installSkill } from '../desktop/skill-install.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hicanvas-skill-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'home'), bundle = join(root, 'bundle'), config = join(root, 'config'), target = join(home, 'custom-skills')
  await Promise.all([home, bundle, config, target].map(p => mkdir(p, { recursive: true })))
  await writeFile(join(bundle, 'SKILL.md'), 'first skill')
  return { root, home, bundle, config, target }
}

test('discovery asks when none or multiple, deduplicates aliases and respects saved custom directory', async t => {
  const f = await fixture(t)
  assert.equal((await discoverSkillDirectory({ home: f.home })).reason, 'not-found')
  await mkdir(join(f.home, '.agents'), { recursive: true })
  await mkdir(join(f.home, '.claude'), { recursive: true })
  await symlink(f.target, join(f.home, '.agents/skills'))
  await symlink(f.target, join(f.home, '.claude/skills'))
  assert.equal((await discoverSkillDirectory({ home: f.home })).directory, f.target)
  await mkdir(join(f.home, '.codex/skills'), { recursive: true })
  assert.equal((await discoverSkillDirectory({ home: f.home })).directory, null)
  await mkdir(join(f.target, 'hicanvas'))
  assert.equal((await discoverSkillDirectory({ home: f.home })).directory, f.target)
  assert.equal((await discoverSkillDirectory({ home: f.home, savedDirectory: join(f.home, 'gone') })).reason, 'saved-missing')
  assert.equal((await discoverSkillDirectory({ home: f.home, savedDirectory: f.target })).directory, f.target)
})

test('install and upgrade only owned files; conflicts leave all files intact until explicit backup', async t => {
  const f = await fixture(t)
  const args = { bundleDirectory: f.bundle, skillDirectory: f.target, configDirectory: f.config, version: '1', command: '/Apps/hiCanvas.app/mcp' }
  assert.equal((await installSkill(args)).status, 'installed')
  const dest = join(f.target, 'hicanvas')
  await writeFile(join(dest, 'mine.txt'), 'keep')
  await writeFile(join(f.bundle, 'SKILL.md'), 'second skill')
  assert.equal((await installSkill({ ...args, version: '2' })).status, 'installed')
  assert.equal(await readFile(join(dest, 'SKILL.md'), 'utf8'), 'second skill')
  await writeFile(join(dest, 'SKILL.md'), 'user notes')
  await writeFile(join(f.bundle, 'SKILL.md'), 'third skill')
  assert.equal((await installSkill({ ...args, version: '3' })).status, 'conflict')
  assert.equal(await readFile(join(dest, 'SKILL.md'), 'utf8'), 'user notes')
  const result = await installSkill({ ...args, version: '3', backup: true })
  assert.equal(result.status, 'installed')
  assert.equal(await readFile(join(result.backupDirectory, 'SKILL.md'), 'utf8'), 'user notes')
  assert.equal(await readFile(join(dest, 'mine.txt'), 'utf8'), 'keep')
  assert.equal(JSON.parse(await readFile(join(dest, 'installation.json'))).command, args.command)
})

test('preexisting unowned skill and nested symlinks are never overwritten silently', async t => {
  const f = await fixture(t), dest = join(f.target, 'hicanvas')
  await mkdir(dest)
  await writeFile(join(dest, 'SKILL.md'), 'user skill')
  const args = { bundleDirectory: f.bundle, skillDirectory: f.target, configDirectory: f.config, version: '1', command: '/app/mcp' }
  assert.equal((await installSkill(args)).status, 'conflict')
  await rm(join(dest, 'SKILL.md'))
  await writeFile(join(f.root, 'outside'), 'private')
  await symlink(join(f.root, 'outside'), join(dest, 'SKILL.md'))
  await assert.rejects(installSkill({ ...args, backup: true }), /符号链接/)
  assert.equal(await readFile(join(f.root, 'outside'), 'utf8'), 'private')
})

test('first launch asks for missing directory, remembers choice and deploys only there', async t => {
  const { createSkillSetup } = await import('../desktop/skill-setup.mjs')
  const f = await fixture(t)
  let prompts = 0, copied
  const dialog = { showOpenDialog: async () => { prompts++; return { canceled: false, filePaths: [f.target] } }, showMessageBox: async () => ({ response: 0 }) }
  const args = { configDirectory: f.config, bundleDirectory: f.bundle, home: f.home, env: {}, command: '/Applications/hiCanvas.app/Contents/Resources/hicanvas-mcp', version: '1', dialog, clipboard: { writeText: text => { copied = text } } }
  const first = createSkillSetup(args)
  assert.equal((await first.setup()).status, 'installed')
  assert.equal(prompts, 1)
  first.copyPrompt()
  assert.match(copied, /hicanvas\/references\/connect.md/)
  assert.match(copied, /不要调用收费接口/)
  assert.equal((await createSkillSetup(args).setup()).directory, f.target)
  assert.equal(prompts, 1)
  await assert.rejects(readFile(join(f.home, '.agents/skills/hicanvas/SKILL.md')), { code: 'ENOENT' })
})

test('cancel keeps app usable; choose later retries; damaged bundle leaves deployed skill intact', async t => {
  const { createSkillSetup } = await import('../desktop/skill-setup.mjs')
  const f = await fixture(t)
  let canceled = true, prompts = 0
  const dialog = { showOpenDialog: async () => { prompts++; return { canceled, filePaths: canceled ? [] : [f.target] } } }
  const args = { configDirectory: f.config, bundleDirectory: f.bundle, home: f.home, env: {}, command: '/app/mcp', version: '1', dialog, clipboard: {} }
  const setup = createSkillSetup(args)
  assert.equal((await setup.setup()).status, 'deferred')
  assert.equal((await setup.setup()).status, 'deferred')
  assert.equal(prompts, 1)
  assert.throws(() => setup.copyPrompt(), /先完成/)
  canceled = false
  assert.equal((await setup.setup(true)).status, 'installed')
  assert.equal(prompts, 2)
  const result = await createSkillSetup({ ...args, bundleDirectory: join(f.root, 'missing') }).setup()
  assert.equal(result.status, 'error')
  assert.equal(await readFile(join(f.target, 'hicanvas/SKILL.md'), 'utf8'), 'first skill')
})

test('changing directory keeps old harness links current, but preserves modified old files', async t => {
  const { linkPreviousSkill } = await import('../desktop/skill-migration.mjs')
  const { skillInstallState } = await import('../desktop/skill-install.mjs')
  const f = await fixture(t)
  const args = { bundleDirectory: f.bundle, configDirectory: f.config, command: '/app/mcp', version: '1' }
  await installSkill({ ...args, skillDirectory: f.target })
  const previous = await skillInstallState(f.config)
  const nextRoot = join(f.home, 'next')
  await mkdir(nextRoot)
  await installSkill({ ...args, skillDirectory: nextRoot })
  assert.equal(await linkPreviousSkill(previous, join(nextRoot, 'hicanvas')), null)
  assert.equal(await realpath(previous.destination), join(nextRoot, 'hicanvas'))
  await writeFile(join(nextRoot, 'hicanvas/SKILL.md'), 'new shared content')
  assert.equal(await readFile(join(previous.destination, 'SKILL.md'), 'utf8'), 'new shared content')
  const current = await skillInstallState(f.config)
  const third = join(f.home, 'third'); await mkdir(third)
  await installSkill({ ...args, skillDirectory: third })
  assert.match(await linkPreviousSkill(current, join(third, 'hicanvas')), /包含用户文件或修改/)
  assert.equal(await readFile(join(nextRoot, 'hicanvas/SKILL.md'), 'utf8'), 'new shared content')
  assert.equal(await linkPreviousSkill(current, previous.destination), null) // 同一真实目录不重复迁移。
})

test('user-deleted owned reference is a conflict and custom-named skill symlink stays valid', async t => {
  const { createSkillSetup } = await import('../desktop/skill-setup.mjs')
  const f = await fixture(t)
  await mkdir(join(f.bundle, 'references'))
  await writeFile(join(f.bundle, 'references/connect.md'), 'guide')
  const custom = join(f.home, 'my-canvas-skill')
  await mkdir(custom)
  await symlink(custom, join(f.target, 'hicanvas'))
  const args = { bundleDirectory: f.bundle, skillDirectory: f.target, configDirectory: f.config, version: '1', command: '/app/mcp' }
  const installed = await installSkill(args)
  assert.equal(installed.destination, custom)
  await rm(join(custom, 'references/connect.md'))
  assert.deepEqual((await installSkill(args)).conflicts, ['references/connect.md'])
  await installSkill({ ...args, backup: true })
  const setup = createSkillSetup({ ...args, home: f.home, env: {}, dialog: {}, clipboard: {} })
  const state = await setup.setup()
  assert.equal(state.guidePath, join(custom, 'references/connect.md'))
  assert.equal(await readFile(state.guidePath, 'utf8'), 'guide')
})

test('concurrent edit during staging aborts upgrade and preserves the new user content', async t => {
  const { readdirSync, writeFileSync } = await import('node:fs')
  const { setImmediate } = await import('node:timers/promises')
  const f = await fixture(t)
  const args = { bundleDirectory: f.bundle, skillDirectory: f.target, configDirectory: f.config, version: '1', command: '/app/mcp' }
  await installSkill(args)
  await mkdir(join(f.bundle, 'references'))
  await writeFile(join(f.bundle, 'references/connect.md'), 'first guide')
  await installSkill(args)
  await mkdir(join(f.target, 'hicanvas/zzz'))
  await Promise.all(Array.from({ length: 10 }, (_, i) => writeFile(join(f.target, `hicanvas/zzz/long-user-reference-file-name-${i}.txt`), 'keep extra')))
  await writeFile(join(f.bundle, 'SKILL.md'), 'upgrade')
  await writeFile(join(f.bundle, 'references/connect.md'), 'upgraded guide')
  const updating = installSkill({ ...args, version: '2' })
  const outcome = updating.then(value => ({ value }), error => ({ error }))
  const deadline = Date.now() + 1000
  while (!readdirSync(f.target).some(name => name.startsWith('.hicanvas-install-')) && Date.now() < deadline) await setImmediate()
  assert.ok(readdirSync(f.target).some(name => name.startsWith('.hicanvas-install-')))
  writeFileSync(join(f.target, 'hicanvas/references/connect.md'), 'concurrent user change')
  assert.match((await outcome).error?.message || '', /部署期间/)
  assert.equal(await readFile(join(f.target, 'hicanvas/references/connect.md'), 'utf8'), 'concurrent user change')
})

test('moving a skill with user-deleted files keeps the old directory and reports it', async t => {
  const { linkPreviousSkill } = await import('../desktop/skill-migration.mjs')
  const { skillInstallState } = await import('../desktop/skill-install.mjs')
  const { lstat } = await import('node:fs/promises')
  const f = await fixture(t)
  await mkdir(join(f.bundle, 'references'))
  await writeFile(join(f.bundle, 'references/connect.md'), 'guide')
  const args = { bundleDirectory: f.bundle, skillDirectory: f.target, configDirectory: f.config, version: '1', command: '/app/mcp' }
  await installSkill(args)
  const previous = await skillInstallState(f.config)
  await rm(join(previous.destination, 'references/connect.md'))
  const next = join(f.home, 'next'); await mkdir(next)
  await installSkill({ ...args, skillDirectory: next })
  assert.match(await linkPreviousSkill(previous, join(next, 'hicanvas')), /包含用户文件或修改/)
  assert.equal((await lstat(previous.destination)).isSymbolicLink(), false)
  await assert.rejects(readFile(join(previous.destination, 'references/connect.md')), { code: 'ENOENT' })
})
