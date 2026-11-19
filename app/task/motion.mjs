// 任务窗的运动：露脸、收回。
// 露脸：先按最终高度摆好，再露脸；页面第一帧是收起状态，下一帧才垂下来。
// 收回：动画放完才藏起来，藏之前不重排。

export const ROLL_MS = 180

// 露脸：摆好位置 → 露脸 → 让页面开始垂下来
export function showTaskWindow(win, bounds, send) {
  win.setBounds(bounds)
  win.show()
  send('in')
}
