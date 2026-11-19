// 任务窗的窗子：透明窗，底色、圆角、阴影都在页面里画。
// 透明窗在 Windows 上的坑：不能拉伸、系统阴影画不出来、全透明的地方收不到拖放。
// 所以 resizable: false、hasShadow: false，页面根节点留一层几乎看不见的底接着拖放，
// 四周再留一圈余量给阴影（页面最外层容器的 padding，见 task.css）。
// 高度固定，不跟内容走：默认 520，拖底边把手改（./height.mjs），宽度不动。

import { t } from '../copy/copy.mjs'

// 面板最低高 360：跟 ./height.mjs 的 MIN_H 同一个数。数定义在这儿——这文件页面那头
// （task.js）也 import，不能连上 node:fs，height.mjs 反过来引这儿的
export const MIN_PANEL = 360

// 看得见的那块面板宽 460；SHADOW_* 是页面里给阴影留的余量（CSS px = DIP）
export const WIDTH = 460
export const SHADOW_X = 12
// 顶上不留余量：任务窗贴着小岛垂下来，缝是 0。留了余量，那一圈透明的窗顶会
// 压在小岛下半截上（Windows 给小岛垫出来的那一截虽然透明，还是小岛的窗，还接点击），
// 点任务窗顶边会打到小岛、把任务窗收了。阴影本来往下偏 6，顶上那点几乎看不见，
// 去掉顶上这圈余量，阴影只留左右和下面。
export const SHADOW_TOP = 0
export const SHADOW_BOTTOM = 26
export const WIN_W = WIDTH + SHADOW_X * 2
// 看得见的缝：面板顶边紧贴看得见的小条底边，0（±1 DIP）
export const GAP = 0

// 面板高换窗高：窗比面板多出上下那圈阴影余量（余量跟着字号档位一起放大）
export const winHeight = (panel, scale = 1) => Math.round(panel) + Math.round(SHADOW_TOP * scale) + Math.round(SHADOW_BOTTOM * scale)

// 字号档位换算：窗宽、四周给阴影留的余量都按档位放大——页面里的 CSS 像素不变，
// zoomFactor 放大以后要占的 DIP 变多；换算完的数四舍五入，差不出 1 像素
export function taskMetrics(scale = 1) {
  return {
    winW: Math.round(WIN_W * scale),
    shadowX: Math.round(SHADOW_X * scale),
    shadowTop: Math.round(SHADOW_TOP * scale),
    shadowBottom: Math.round(SHADOW_BOTTOM * scale),
  }
}

// 摆窗（纯计算）：水平跟小岛居中、左右不出工作区；面板顶边紧贴小岛底边（缝 GAP = 0）。
// 窗顶上面有 SHADOW_TOP 的透明余量（现在是 0），y 得先扣掉它，看得见的缝才是 GAP——
// 不扣的话小条和面板之间看得见的缝是 GAP + SHADOW_TOP；余量跟着字号档位放大
// （scale），扣的时候也用放大后的那份，看得见的缝始终是 GAP。
// 高度用外面给的 clamp 夹（上下限都在 ./height.mjs）；夹完的窗底（连底下的阴影余量）
// 不出工作区。scale ≠ 1 时面板最低高（minPanel）也按档位放大。
// 不碰 Electron，node --test 直接测。
export function placeTaskWindow({ island, workArea, panel, maxPanel, clamp, scale = 1, minPanel = MIN_PANEL }) {
  const { winW, shadowTop, shadowBottom } = taskMetrics(scale)
  let x = Math.round(island.x + island.width / 2 - winW / 2)
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winW))
  const y = Math.round(island.y + island.height + GAP - shadowTop)
  // 工作区里还装得下多高的面板：y 是窗顶，上下的阴影余量都不算面板
  const room = workArea.y + workArea.height - y - shadowTop - shadowBottom
  const panelHeight = clamp(panel, Math.min(maxPanel, room), minPanel)
  return { bounds: { x, y, width: winW, height: winHeight(panelHeight, scale) }, panelHeight }
}

// 建窗的选项：壳建窗时用，测试也照这个断言
export function taskWindowOptions({ width = WIN_W, height = 570, onTop = true, icon = '' } = {}) {
  return {
    width, height, show: false, frame: false,
    // 透明窗：屏上看到的只有在动的那块
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: onTop, skipTaskbar: true,
    // 阴影自己画（页面里 box-shadow），系统阴影透明窗用不了
    hasShadow: false,
    title: t('sidemate'), icon,
  }
}
