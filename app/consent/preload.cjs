const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('consent', {
  content: () => ipcRenderer.invoke('consent:content'),
  agree: (payload) => ipcRenderer.invoke('consent:agree', payload),
  cancel: () => ipcRenderer.invoke('consent:cancel'),
})
