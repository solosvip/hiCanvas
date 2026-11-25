import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { ensureService } from '../mcp/startup.mjs'
import { loadConnection, connectionEnv, desktopConfigDir, parseDeepLink } from '../mcp/connection.mjs'
import { navigateCanvas, saveBeforeLeaving } from './window-navigation.mjs'
import { allowedNavigation, externalLink, validateCanvasLink } from './navigation.mjs'

app.setName('hiCanvas')
app.setPath('userData', desktopConfigDir())
if (process.env.HICANVAS_DESKTOP_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.HICANVAS_DESKTOP_DEBUG_PORT)
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
let window
let connection
let quitting = false
let pendingLink
let opening = Promise.resolve()
const report = error => dialog.showErrorBox('hiCanvas 无法打开', error.message)
function queueLink(value) {
  pendingLink = value
  if (app.isReady() && connection) opening = opening.then(() => showCanvas(value)).catch(report)
}
app.on('open-url', (event, url) => { event.preventDefault(); queueLink(url) })
app.on('second-instance', (_event, argv) => {
  const link = argv.find(value => value.startsWith('hicanvas:'))
  if (link) queueLink(link)
  else if (window) { window.showInactive(); if (window.isMinimized()) window.restore() }
  else opening = opening.then(() => showCanvas()).catch(report)
})
function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'hiCanvas', submenu: [{ label: '关于 hiCanvas', role: 'about' }, { type: 'separator' }, { label: '隐藏 hiCanvas', role: 'hide' }, { label: '隐藏其他应用', role: 'hideOthers' }, { label: '显示全部', role: 'unhide' }, { type: 'separator' }, { label: '退出 hiCanvas', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '重新加载画板', role: 'reload' }, { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { type: 'separator' }, { label: '进入全屏', role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '缩放', role: 'zoom' }, { label: '关闭窗口', role: 'close' }] }
  ]))
}
async function showCanvas(link) {
  let url = connection.baseUrl + '/'
  if (link) url = await validateCanvasLink(parseDeepLink(link))
  else await ensureService(connection.baseUrl, { ...connection, appRoot: app.getAppPath() })
  if (!window) {
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 640, minHeight: 480, title: 'hiCanvas', show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } })
    const contents = window.webContents
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    contents.session.setPermissionCheckHandler(() => false)
    contents.setWindowOpenHandler(({ url }) => {
      if (externalLink(url)) shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, target) => { if (!allowedNavigation(target, new URL(contents.getURL()).origin)) event.preventDefault() })
    contents.on('will-attach-webview', event => event.preventDefault())
    let savedForClose = false
    let closing = false
    window.on('close', event => {
      if (savedForClose) return
      event.preventDefault()
      if (closing) return
      closing = true
      saveBeforeLeaving(contents).then(() => { savedForClose = true; if (quitting) app.quit(); else window?.close() }).catch(error => { closing = false; quitting = false; report(error) })
    })
    window.on('closed', () => { window = null })
    window.once('ready-to-show', () => window?.showInactive())
  }
  await navigateCanvas(window.webContents, url)
  window.showInactive()
}
if (locked) app.whenReady().then(async () => {
  connection = loadConnection()
  Object.assign(process.env, connectionEnv(connection))
  installMenu()
  app.setAsDefaultProtocolClient('hicanvas')
  const initial = pendingLink || process.argv.find(value => value.startsWith('hicanvas:'))
  // 首次深链也只接受已运行、资料标识相符的本机服务，不按链接创建资料目录。
  opening = opening.then(() => showCanvas(initial))
  await opening
  app.on('activate', () => { if (!window) opening = opening.then(() => showCanvas()).catch(report) })
}).catch(error => { report(error); app.quit() })
app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
