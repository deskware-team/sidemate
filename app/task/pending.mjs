// 待发的文件：挂着的文件里去掉已经发出去过的（名字进了「我说的」或插进去的那句）。
// 只在主进程里用（./unseen.mjs 认扫描件要读盘）。
// 「看不了图的那几份」（./unseen.mjs）和「发不发得出去」都从这里取同一份清单；
// 干活中挂上的那几份也靠它认：还没发出去的才能在干活中去掉。

import { unseenFiles } from './unseen.mjs'

// 发出去过的：对话流里「我说的」那一条、插进去的那句带的小签名字
function sentNames(state) {
  const sent = new Set()
  for (const one of state?.flow || []) {
    if (!one || (one.kind !== 'user' && one.kind !== 'steer')) continue
    for (const file of one.files || []) sent.add(typeof file === 'string' ? file : file?.name)
  }
  return sent
}

// 还挂在输入框上、没发出去的
export function pendingFiles(state) {
  const sent = sentNames(state)
  return (state?.files || []).filter((one) => one && !sent.has(one.name))
}

// 这几份里，现在的模型读不了内容的（图片、扫描的 PDF）：带着它们就发不出去
export function unseenPending(state, { sees = () => false, scanned } = {}) {
  return unseenFiles(pendingFiles(state), { sees, scanned })
}
