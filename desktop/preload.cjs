const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('hiCanvasDesktop', {
  skillStatus: () => ipcRenderer.invoke('hicanvas:skill-status'),
  chooseSkillDirectory: () => ipcRenderer.invoke('hicanvas:skill-choose'),
  copySkillPrompt: () => ipcRenderer.invoke('hicanvas:skill-copy')
})
