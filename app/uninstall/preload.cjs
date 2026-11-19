const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('uninstall', {
  answer: (payload) => ipcRenderer.invoke('uninstall:answer', payload),
})
