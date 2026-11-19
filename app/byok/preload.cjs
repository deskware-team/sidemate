const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('byok', {
  boot: () => ipcRenderer.invoke('byok:boot'),
  saveDeepseek: (key) => ipcRenderer.invoke('byok:save-deepseek', key),
  saveZhipu: (key) => ipcRenderer.invoke('byok:save-zhipu', key),
  useKilo: () => ipcRenderer.invoke('byok:free'),
  checkCustom: () => ipcRenderer.invoke('byok:check-custom'),
  guide: (which) => ipcRenderer.invoke('byok:guide', which),
  openUrl: (url) => ipcRenderer.invoke('byok:open-url', url),
  openSettings: () => ipcRenderer.invoke('byok:open-settings'),
  playIntro: () => ipcRenderer.invoke('byok:intro'),
  close: () => ipcRenderer.invoke('byok:close'),
})
