// 首次运行第一屏是「关于桌伴」：一个标题、三句话，字在 app/copy/ui-windows.mjs（firstRun.about*），
// 页面直接用 data-t 摆，这里不另留一份。第二步「选模型」的字也在 page.html 里。

import { INTRO_LINE } from '../pet/intro.mjs'

// 第三步那句话跟小岛冒的那一行是同一句
export const INTRO_HINT = INTRO_LINE
// DeepSeek / 智谱的「密钥获取教程」文字在 app/models/guides.mjs。
