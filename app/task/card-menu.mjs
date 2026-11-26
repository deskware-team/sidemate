// 成品卡右键菜单的模板（纯函数，好测）：四项，顺序和文字照卡上定的。
// labels 是四项的文字，type 是点了以后发给主进程的动作（跟 runner 那边的分发对上）。

export function cardMenuTemplate(labels) {
  return [
    { label: labels.preview, type: 'preview' },
    { label: labels.open, type: 'open' },
    { label: labels.reveal, type: 'reveal' },
    { label: labels.saveAs, type: 'save-as' },
  ]
}
