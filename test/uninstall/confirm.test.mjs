// 卸载前那一问：页面的回答怎么换成卸载器认的退出码，页面上的字和按钮都在。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { t } from '../../app/copy/copy.mjs'

// shell.mjs 引 electron，纯 node 下只验它导出的规则：把规则那几行抠出来单独跑
const source = readFileSync(new URL('../../app/uninstall/shell.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('退出码：点卸载才算卸，勾了才删数据；别的都是不卸', async () => {
  const exitSrc = source.match(/export const EXIT = [^\n]*\n/)[0]
  const fnSrc = source.match(/export function exitCodeOf[\s\S]*?\n}\n/)[0]
  const flagSrc = source.match(/export const UNINSTALL_FLAG = [^\n]*\n/)[0]
  const wantsSrc = source.match(/export function wantsUninstallConfirm[\s\S]*?\n}\n/)[0]
  const mod = await import(`data:text/javascript,${encodeURIComponent(exitSrc + fnSrc + flagSrc + wantsSrc)}`)
  assert.deepEqual({ ...mod.EXIT }, { cancel: 0, keep: 1, wipe: 2 })
  assert.equal(mod.exitCodeOf({ ok: true, wipe: false }), 1)
  assert.equal(mod.exitCodeOf({ ok: true, wipe: true }), 2)
  assert.equal(mod.exitCodeOf({ ok: false, wipe: true }), 0, '没点卸载：勾了也不删')
  assert.equal(mod.exitCodeOf(null), 0)
  assert.equal(mod.wantsUninstallConfirm(['sidemate.exe', '--uninstall-confirm']), true)
  assert.equal(mod.wantsUninstallConfirm(['sidemate.exe', '--login']), false)
})

test('页面：一句确认、一个默认不勾的勾选、取消和卸载两个按钮、右上角关闭', () => {
  const html = readFileSync(new URL('../../app/uninstall/page.html', import.meta.url), 'utf8')
  assert.match(html, /data-t="uninstall.confirm"/)
  assert.match(html, /<input type="checkbox" id="wipe">/, '勾选默认不勾')
  assert.match(html, /id="cancel"[^>]*data-t="uninstall.cancel"/)
  assert.match(html, /id="ok"[^>]*data-t="uninstall.ok"/)
  assert.match(html, /id="win-close"/)
  assert.equal(t('uninstall.wipe'), '同时删除全部配置和记录（包括任务里生成的文件，删除后无法恢复）')
  assert.equal(t('uninstall.cancel'), '取消')
})
