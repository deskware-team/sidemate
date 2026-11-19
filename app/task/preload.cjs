// 任务窗的桥，十四个通道：task:ready 拿当前视图，task:view 收主进程推来的新视图，
// task:act 发用户的动作，task:drop 发拖进来的文件（路径用 webUtils 取，Electron 32 起没有 File.path），
// task:paste 发贴进来的图片 / 长文字，task:restore 改回文字（取回存下来的那一段），
// task:thumb 拿小签缩略图，task:open-chip 点气泡里的小块（开工作区里的那份拷贝，主进程核路径），
// task:drag-out 从产出卡里把文件拖出去（主进程起系统拖拽），task:drag-prep 按下产出卡时先问好这种文件的图标，
// task:drag-end 拖完了主进程说一声，
// task:height 发拖底边把手的指针（高度怎么算在主进程），
// task:link 让主进程用系统浏览器开回话里的链接（主进程再核一遍协议），
// task:models 拿「换模型」的列表和当前选的，task:consent 弹 Kilo 模型使用须知，
// task:history-list 拿历史对话的列表（能搜能筛，按天分好组），task:history-open 打开一条历史对话，
// task:hide 收起任务窗（页面里按 Esc，弹层都没开的时候）。

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('task', {
  ready: () => ipcRenderer.invoke('task:ready'),
  onView: (fn) => ipcRenderer.on('task:view', (_event, view) => fn(view)),
  onModels: (fn) => ipcRenderer.on('task:models', (_event, payload) => fn(payload)),
  onAnim: (fn) => ipcRenderer.on('task:anim', (_event, kind) => fn(kind)),
  act: (action) => ipcRenderer.send('task:act', action),
  height: (payload) => ipcRenderer.send('task:height', payload),
  drop: (files) => ipcRenderer.send('task:drop', { paths: [...files].map((file) => webUtils.getPathForFile(file)) }),
  pasteImages: (list) => ipcRenderer.send('task:paste', { images: list }),
  pasteText: (text) => ipcRenderer.send('task:paste', { text }),
  restore: (path) => ipcRenderer.invoke('task:restore', { path }),
  thumb: (path) => ipcRenderer.invoke('task:thumb', { path }),
  openChip: (path) => ipcRenderer.invoke('task:open-chip', { path }),
  dragOut: (path) => ipcRenderer.send('task:drag-out', { path }),
  dragPrep: (path) => ipcRenderer.send('task:drag-prep', { path }),
  onDragEnd: (fn) => ipcRenderer.on('task:drag-end', () => fn()),
  openLink: (url) => ipcRenderer.send('task:link', url),
  models: () => ipcRenderer.invoke('task:models'),
  consent: () => ipcRenderer.invoke('task:consent'),
  historyList: (payload) => ipcRenderer.invoke('task:history-list', payload),
  historyOpen: (id) => ipcRenderer.invoke('task:history-open', { id }),
  hide: () => ipcRenderer.send('task:hide'),
})
