// 预览窗的桥：list 拿左栏的两组，show 拿这份文件怎么显示，pages 再要几页（一页一张图的文档），
// open 用系统程序打开，save-as 另存为，close 关窗（Esc 和右上角那个按钮都走它）。

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('preview', {
  list: () => ipcRenderer.invoke('preview:list'),
  show: (path) => ipcRenderer.invoke('preview:show', path),
  pages: (path, pages, dpi) => ipcRenderer.invoke('preview:pages', path, pages, dpi),
  open: (path) => ipcRenderer.invoke('preview:open', path),
  reveal: (path) => ipcRenderer.invoke('preview:reveal', path),
  saveAs: (path) => ipcRenderer.invoke('preview:save-as', path),
  close: () => ipcRenderer.send('preview:close'),
  onPick: (fn) => ipcRenderer.on('preview:pick', (_event, path) => fn(path)),
})
