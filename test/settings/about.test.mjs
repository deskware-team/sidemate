// 「关于」页的纯函数和模型文件路径。about.mjs、files.mjs 都不碰 electron，node --test 直接测。
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { DOCS, SITE_URL, SOURCE_URL, consentLine, docPath, isSourceUrl } from '../../app/settings/about.mjs'
import { modelFiles } from '../../app/models/files.mjs'
import { appRoot } from '../../app/paths.mjs'

const ROOT = 'C:\\repo'
const APP_PATH = 'C:\\用户\\me\\AppData\\Local\\Programs\\sidemate\\resources\\app'
const EXEC_PATH = 'C:\\用户\\me\\AppData\\Local\\Programs\\sidemate\\sidemate.exe'

test('开发时：四份文档都从仓库根找', () => {
  const dev = { packaged: false, appPath: ROOT, execPath: EXEC_PATH }
  assert.equal(docPath('PRIVACY.md', dev), join(ROOT, 'PRIVACY.md'))
  assert.equal(docPath('LICENSE', dev), join(ROOT, 'LICENSE'))
  assert.equal(docPath('THIRD-PARTY-NOTICES.txt', dev), join(ROOT, 'THIRD-PARTY-NOTICES.txt'))
  // Kilo 模型使用须知跟着 app/legal 走，开发和打包同一条路
  assert.equal(docPath('kilo-terms.md', dev), join(ROOT, 'app', 'legal', 'kilo-terms.md'))
})

test('打包后：隐私和许可在应用目录，第三方声明在 exe 旁边', () => {
  const packaged = { packaged: true, appPath: APP_PATH, execPath: EXEC_PATH }
  assert.equal(docPath('PRIVACY.md', packaged), join(APP_PATH, 'PRIVACY.md'))
  assert.equal(docPath('LICENSE', packaged), join(APP_PATH, 'LICENSE'))
  assert.equal(docPath('THIRD-PARTY-NOTICES.txt', packaged), join(dirname(EXEC_PATH), 'THIRD-PARTY-NOTICES.txt'))
  assert.equal(docPath('kilo-terms.md', packaged), join(APP_PATH, 'app', 'legal', 'kilo-terms.md'))
})

test('同意状态四种情况：没同意、已同意、已同意且默认是 Kilo 线路、说明改版', () => {
  const at = new Date(2026, 10, 11, 9, 30).getTime() // 本地 2026-11-11
  assert.deepEqual(
    consentLine({ agreed: false, version: null, at: null, stale: false }, {}),
    { text: '未同意', brief: '未同意', button: null },
  )
  assert.deepEqual(
    consentLine({ agreed: true, version: '1.0', at, stale: false }, { defaultIsFree: false }),
    { text: '已于 11-11 同意 v1.0', brief: '已同意 v1.0', button: '撤回同意' },
  )
  assert.deepEqual(
    consentLine({ agreed: true, version: '1.0', at, stale: false }, { defaultIsFree: true }),
    {
      text: '已于 11-11 同意 v1.0，默认模型为 Kilo 模型',
      brief: '已同意 v1.0',
      button: '撤回同意',
    },
  )
  assert.deepEqual(
    consentLine({ agreed: false, version: '0.9', at, stale: true }, { defaultIsFree: true }),
    { text: '使用须知已更新，需重新同意', brief: '使用须知已更新', button: null },
  )
})

test('同意过又撤回了：跟没同意过分开说', () => {
  const at = new Date(2026, 10, 11).getTime()
  assert.deepEqual(
    consentLine({ agreed: false, version: '1.0', at, stale: false }, {}),
    { text: '已撤回，Kilo 模型已停用', brief: '已撤回', button: null },
  )
})

test('modelFiles：清单、同意、能力、工具服务都在程序数据根目录下', () => {
  const files = modelFiles('C:\\桌伴根')
  assert.equal(files.catalog, join('C:\\桌伴根', 'model.json'))
  assert.equal(files.consent, join('C:\\桌伴根', 'useragreement.json'))
  assert.equal(files.ability, join('C:\\桌伴根', 'ability.json'))
  assert.equal(files.mcp, join('C:\\桌伴根', 'mcp.json'))
  const here = modelFiles()
  assert.equal(here.catalog, join(appRoot(), 'model.json'))
})

test('外链只放行源码仓库这一个地址，官网先留空', () => {
  assert.equal(SOURCE_URL, 'https://github.com/deskware-team/sidemate')
  assert.equal(isSourceUrl(SOURCE_URL), true)
  assert.equal(isSourceUrl('https://github.com/deskware-team/sidemate/x'), false)
  assert.equal(isSourceUrl('https://github.com/deskware-team/other'), false)
  assert.equal(isSourceUrl('https://evil.example'), false)
  assert.equal(isSourceUrl(''), false)
  assert.equal(SITE_URL, '')
  assert.equal(DOCS.length, 4)
  assert.deepEqual(DOCS.map((doc) => doc.title), ['隐私与使用声明', 'Kilo 模型使用须知', '第三方组件许可', '开源许可（MIT）'])
})
