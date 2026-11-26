// 图的右键菜单（纯函数，好测）：两项——另存为图片、复制图片；外加默认文件名的算法。
// 菜单在主进程弹（系统菜单），页面只发「用户点了哪张图的右键」。

export function chartMenuTemplate(labels) {
  return [
    { label: labels.saveAs, type: 'save-as' },
    { label: labels.copy, type: 'copy' },
  ]
}

// Windows 文件名里不能用的字符，换成空格；结尾的点和空格也去掉
const BAD = /[\\/:*?"<>|\u0000-\u001f]/g

function clean(text) {
  return String(text ?? '')
    .replace(BAD, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
}

// 默认文件名：图的标题；没标题就用兜底的名字（统计图 / 流程图）。后缀 .png
export function chartFileName(title, fallback) {
  const name = clean(title) || clean(fallback) || 'image'
  return `${name}.png`
}
