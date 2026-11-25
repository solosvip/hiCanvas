import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { discoverSkillDirectory } from './skill-discovery.mjs'
import { linkPreviousSkill } from './skill-migration.mjs'
import { installSkill, skillInstallState } from './skill-install.mjs'

export function createSkillSetup({ configDirectory, bundleDirectory, command, version, dialog, clipboard, parent = () => null, home = homedir(), env = process.env }) {
  let state = { status: 'checking' }, pending
  const preferencesPath = join(configDirectory, 'skill-preferences.json')
  async function preferences() {
    try { return JSON.parse(await readFile(preferencesPath, 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }
  async function remember(value) {
    await mkdir(configDirectory, { recursive: true })
    await writeFile(preferencesPath, JSON.stringify(value, null, 2) + '\n')
  }
  async function message(options) {
    const owner = parent()
    return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options)
  }
  async function chooseDirectory(candidates) {
    const options = { title: '选择 Skill 目录', message: candidates.length ? `检测到多个目录，请选择 AI 使用的技能根目录：\n${candidates.join('\n')}` : '未找到可确定的 Skill 目录，请选择部署位置。hiCanvas 会在此目录中创建 hicanvas 文件夹。', buttonLabel: '部署到此目录', properties: ['openDirectory', 'createDirectory'], defaultPath: candidates[0] || home }
    const owner = parent()
    const selected = await (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options))
    if (selected.canceled || !selected.filePaths.length) return null
    const chosen = selected.filePaths[0]
    return basename(chosen) === 'hicanvas' ? dirname(chosen) : chosen
  }
  async function execute(choose) {
    try {
      const prefs = await preferences()
      const previous = await skillInstallState(configDirectory)
      const found = await discoverSkillDirectory({ home, env, savedDirectory: prefs.directory || previous?.directory })
      let directory = choose ? null : found.directory
      if (!directory && !choose && prefs.deferred) return state = { status: 'deferred', message: '尚未部署 Skill，请选择部署目录。' }
      if (!directory) directory = await chooseDirectory(found.candidates)
      if (!directory) { await remember({ ...prefs, deferred: true }); return state = { status: 'deferred', message: '已跳过部署，可随时在这里选择目录。' } }
      await remember({ directory, deferred: false })
      const args = { bundleDirectory, skillDirectory: directory, configDirectory, command, version }
      let result = await installSkill(args)
      if (result.status === 'conflict') {
        const answer = await message({ type: 'question', title: '保留修改过的 Skill', message: '现有 hiCanvas Skill 与随附版本不同', detail: `目录：${directory}\n修改文件：${result.conflicts.join('、')}\n保留现有文件不会覆盖你的修改；备份并更新会把完整旧版保存在应用配置目录。`, buttons: ['保留现有文件', '备份并更新'], defaultId: 0, cancelId: 0 })
        if (answer.response === 1) result = await installSkill({ ...args, backup: true })
      }
      const message = result.status === 'installed' ? await linkPreviousSkill(previous, result.destination) : undefined
      state = { ...result, message, guidePath: join(result.destination, 'references/connect.md'), command }
      return state
    } catch (error) { return state = { status: 'error', message: error.message } }
  }
  function setup(choose = false) {
    if (pending) return pending
    pending = execute(choose).finally(() => { pending = null })
    return pending
  }
  return {
    setup,
    async showConnection() {
      const ready = state.status === 'installed'
      const answer = await message({ type: 'info', title: 'AI 接入', message: ready ? 'hiCanvas Skill 已部署' : 'hiCanvas Skill 尚未部署完成', detail: state.directory ? `目录：${state.destination}` : state.message || '请选择 Skill 目录。', buttons: ready ? ['关闭', '复制接入指令', '更改部署目录'] : ['关闭', '选择部署目录'], defaultId: 0, cancelId: 0 })
      if (ready && answer.response === 1) this.copyPrompt()
      else if (answer.response > 0) await setup(true)
    },
    status: () => state,
    copyPrompt() {
      if (state.status !== 'installed') throw new Error('请先完成 Skill 部署，再复制接入指令。')
      const prompt = `请把 hiCanvas 接入你当前工作的 AI 宿主。先完整阅读本机文件：${state.guidePath}，再按说明配置 MCP 并验证工具可用。保留其他 MCP 和已有配置；不要调用收费接口测试。`
      clipboard.writeText(prompt)
      return '接入指令已复制，粘贴给要接入的 AI 即可。'
    }
  }
}
