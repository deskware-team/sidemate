// 电脑忙（页面这一半）：忙时只停装饰小动作——东张西望、眼睛跟鼠标、睡着时的呼吸；
// 有意义的神情（读 / 写 / 想 / 做完了 / 没干成 / 要你看一眼 / 等文件时跟着文件看 / 犯困 / 睡着 /
// 醒来 / 拖着走）和眨眼照常。不加专用表情，不加设置开关。
// 纯文本检查，不拉起 Electron。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '../../app/pet/pet.js'), 'utf8')
const motionSrc = readFileSync(join(here, '../../app/pet/motion.mjs'), 'utf8')
const posesSrc = readFileSync(join(here, '../../app/pet/poses.mjs'), 'utf8')
const labHtml = readFileSync(join(here, '../../tools/pet-lab/index.html'), 'utf8')
const labJs = readFileSync(join(here, '../../tools/pet-lab/lab.js'), 'utf8')

test('忙时 near 不跟：onNear 里 busy 就不 setGaze、也不「看到你了」眨眼', () => {
  // busy 在 blink / setGaze 之前就 return（touchActivity 还算动静，犯困照旧）
  assert.match(page, /pet\.onNear\(\(payload\) => \{[\s\S]*?touchActivity\(\)[\s\S]*?if \(busy\) return[\s\S]*?if \(!was\) animator\.blink\(\)[\s\S]*?animator\.setGaze\(\{ x: payload\?\.dx \|\| 0/)
})

test('onBusy 和开机数据的 busy 记在一个变量里，变了就 setQuiet 并叫醒循环', () => {
  assert.match(page, /pet\.onBusy\(\(payload\) => applyBusy\(payload\?\.busy === true\)\)/)
  assert.match(page, /if \(boot\.busy\) applyBusy\(true\)/)
  assert.match(page, /function applyBusy\(on\) \{[\s\S]*?busy = next[\s\S]*?motion\.setQuiet\(busy\)/)
  // 叫醒循环：换排程后重画一帧（呼吸标记这些）
  assert.match(page, /function applyBusy\(on\) \{[\s\S]*?refreshPose\(\)/)
  // 已经在跟的松开；拖文件那一路（bindDrop 的 dragover）不动，照跟
  assert.match(page, /if \(busy && nearOn\) animator\.setGaze\(null\)/)
  const drop = page.slice(page.indexOf('function bindDrop'), page.indexOf('function playPress'))
  assert.ok(drop.includes("animator.setGaze(plan.near"), 'bindDrop 里跟文件的 setGaze 被动了')
  assert.ok(!drop.includes('busy'), 'bindDrop 里不该看 busy（拖文件照跟）')
})

test('引擎的 quiet：idle 不东张西望、呼吸一律 false、wakeIn 不算东张西望', () => {
  assert.match(motionSrc, /setQuiet\(on\) \{/)
  assert.match(motionSrc, /breathing: quiet \? false : g\.breathing/)
  assert.match(motionSrc, /name === 'idle' && !quiet && !\(gazeAt && gazeAt\(t\)\)/)
  // 忙着进的 idle 也不排（setPose 里带上）
  assert.match(motionSrc, /if \(quiet\) st\.quiet = true/)
  // poses 的 idle 看着 st.quiet：视线留中间，setGaze 照跟
  assert.match(posesSrc, /if \(st\.quiet\) \{[\s\S]*?return g/)
})

test('调试台「其它」里有「电脑忙」勾选框，勾上发 busy', () => {
  assert.match(labHtml, /<input type="checkbox" id="busy"> 电脑忙/)
  assert.match(labJs, /getElementById\('busy'\)[\s\S]*?fire\('busy', \{ busy: event\.target\.checked \}\)/)
})
