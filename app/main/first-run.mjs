// 点小岛以后走哪条路：开任务窗，还是开首次运行窗（贴钥匙）。
// 这一层不引 electron，node --test 直接测。

import { modelConfigured } from '../byok/first.mjs'

export { modelConfigured }

// 点小岛该走哪条路：'first-run' 开首次运行窗（贴钥匙），'task' 开任务窗。
// configured：用户配过模型没有（modelConfigured 算出来的）
// login：这次是不是开机启动起来的（命令行带 --login）
// 真正没配过任何模型的新用户才走首次运行；开机启动那一次也一样，不因为是开机来的就换路。
export function islandClick({ configured = false, login = false } = {}) {
  return configured === true ? 'task' : 'first-run'
}
