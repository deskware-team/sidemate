// 开机启动那一次（命令行里带 --login）怎么起来：
// 只出小岛，不开任务窗、不播小岛出场、不自己弹首次运行。
// 这一层不引 electron，node --test 直接测。

export function startupPlan({ argv = [] } = {}) {
  const list = Array.isArray(argv) ? argv : []
  const login = list.includes('--login')
  return {
    login,
    // 开机启动那次只留小岛
    openTask: !login,
    playIntro: !login,
    firstRun: !login,
  }
}
