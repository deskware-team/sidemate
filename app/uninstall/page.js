// 卸载前那一问的页面：点「卸载」把勾没勾交给主进程；点「取消」、右上角关闭、按 Esc 都是不卸。
import { paint } from '../copy/copy.mjs'

// 页面里写死的字换成文案表里的那一份（窗口第一次显示前调一次）
paint(document)

const wipe = document.getElementById('wipe')
const cancel = () => window.uninstall.answer({ ok: false })

document.getElementById('ok').addEventListener('click', () => window.uninstall.answer({ ok: true, wipe: wipe.checked }))
document.getElementById('cancel').addEventListener('click', cancel)
document.getElementById('win-close').addEventListener('click', cancel)
addEventListener('keydown', (event) => { if (event.key === 'Escape') cancel() })
// 默认落在「取消」上：回车不会一下就卸掉
document.getElementById('cancel').focus()
