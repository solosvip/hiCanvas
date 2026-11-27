import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAttemptFiles } from './asset-attempt-files.mjs'

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'owned-assets-')), dir = join(root, 'assets')
  await mkdir(dir); t.after(() => rm(root, { recursive: true, force: true }))
  return { root, dir, files: createAttemptFiles(root), target: name => ({ assetPath: join(dir, name), assetUrl: '/synthetic/' + name }) }
}
test('只清理本次wx成功创建的文件；已有同字节文件和已保护文件保留', async t => {
  const f = await setup(t), old = f.target('old.png'), kept = f.target('saved.png'), fresh = f.target('new.png')
  await writeFile(old.assetPath, 'same'); await f.files.write(kept, Buffer.from('same')); await f.files.write(fresh, Buffer.from('same'))
  await assert.rejects(f.files.write(old, Buffer.from('same')), e => e.code === 'EEXIST')
  f.files.protect(new Set([kept.assetUrl]))
  assert.deepEqual(await f.files.rollback(), { removed: 1, remaining: 0, failures: [] })
  assert.deepEqual((await readdir(f.dir)).sort(), ['old.png', 'saved.png'])
  assert.equal(await readFile(old.assetPath, 'utf8'), 'same')
})
test('路径越界、符号链接目录和清理前身份已改变均不取得别人的文件', async t => {
  const f = await setup(t), target = f.target('owned.png')
  await assert.rejects(f.files.write({ assetPath: join(f.root, '../escape.png'), assetUrl: '/escape' }, Buffer.from('bad')), /目录/)
  const outside = await mkdtemp(join(tmpdir(), 'outside-assets-')); t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(f.dir, 'link'))
  await assert.rejects(f.files.write({ assetPath: join(f.dir, 'link/secret'), assetUrl: '/secret' }, Buffer.from('bad')), /目录/)
  await f.files.write(target, Buffer.from('mine')); await rename(target.assetPath, target.assetPath + '.moved'); await writeFile(target.assetPath, 'other')
  const result = await f.files.rollback()
  assert.equal(result.remaining, 1); assert.equal(result.failures.length, 1)
  assert.equal(await readFile(target.assetPath, 'utf8'), 'other')
})

test('写入中途失败仍记本次部分文件；ENOENT已清理不报错', async t => {
  const f = await setup(t), target = f.target('partial.png')
  await assert.rejects(f.files.write(target, Symbol('bad bytes')), TypeError)
  assert.equal(f.files.size, 1)
  assert.equal((await f.files.rollback()).removed, 1)
  await f.files.write(target, Buffer.from('mine')); await rm(target.assetPath)
  assert.deepEqual(await f.files.rollback(), { removed: 0, remaining: 0, failures: [] })
})
