// 托盘图标：Electron 读 ico 只挑最大那档（256），直接缩会糊；
// 这里从 ico 目录里取对应档的 PNG 帧（make-icon.py 画的每档都是 PNG 帧），取不到再兜底缩。

import { readFileSync } from 'node:fs'
import { nativeImage, screen } from 'electron'
import { iconPath } from '../assets/icon.mjs'

export function trayIcon() {
  const size = (screen.getPrimaryDisplay().scaleFactor || 1) >= 2 ? 32 : 16
  const raw = readFileSync(iconPath)
  for (let i = 0; i < raw.readUInt16LE(4); i++) {
    const at = 6 + i * 16 // 目录每档 16 字节：宽(+0，256 记 0)、数据大小(+8)、偏移(+12)
    if ((raw[at] || 256) !== size) continue
    const off = raw.readUInt32LE(at + 12)
    const len = raw.readUInt32LE(at + 8)
    if (raw[off] === 0x89 && raw[off + 1] === 0x50) return nativeImage.createFromBuffer(raw.subarray(off, off + len))
  }
  return nativeImage.createFromPath(iconPath).resize({ width: size, height: size })
}
