// 还留在页面这边的几个数（形状和动法都搬进了弹簧引擎：
// poses.mjs 给各神情的目标、motion.mjs 用弹簧追、animator.mjs 排帧和定时）。
// 这儿只剩壳和页面两边共用的：看你（near.mjs）、接文件·期待（expect.mjs）、
// 犯困的坎（sleepy.mjs / pose-pick.mjs）、拖着走的恢复（pet.js）。
// 纯函数，不碰 electron，好测。

// 鼠标靠近·看你：「鼠标进到小岛矩形 120px（DIP）以内，眼睛朝鼠标那边挪：
// x = 3 × clamp((鼠标x − 小岛中心x) / 60, −1, 1)，y 固定 −1（抬起 1）」；壳里轮询 120ms。
export const NEAR = { rangePx: 120, reachPx: 60, maxPx: 3, liftPx: -1, pollMs: 120 }

// 接文件·期待：眼睛放大、整岛那一下弹都归引擎演，这里剩壳要等的时长（张托前等这么久）。
export const EXPECT = { waitMs: 250 }

// 拖着走 · > <：松手 150ms 恢复到当前状态的神情（> < 本身是引擎的 drag 神情）。
export const DRAG = { backMs: 150 }

// 犯困到睡着统一一个 10 分钟（11-24 定）：10 分钟没动静先打个盹（眼皮垂下、慢眨一次，约 4 秒），
// 接着睡着。pose-pick 的 sleepLevel 拿这两个数分档；dozeMs 是「打盹」那几秒，盖过 drowsy 神情走完的 2.56 秒。
const IDLE_MS = 10 * 60 * 1000
const DOZE_MS = 4000
export const SLEEPY = { idleMs: IDLE_MS, dozeMs: DOZE_MS, asleepMs: IDLE_MS + DOZE_MS }
