// 程序数据目录的布局：每个位置只在 app/paths.mjs 里定一次。
// 这里查四件事：
// 1. 根目录和底下每个文件、目录的名字（英文、全在 %LOCALAPPDATA%\sidemate 下面）
// 2. 任务文件夹的名字：年月日时分 + 两位随机数（14 位数字），撞了名重摇
// 3. 历史从任务文件夹里扫出来：删了文件夹，那条历史就没了
// 4. 密钥在 model.json 里来回（用假加密）、用户拖进来的文件拷进 received\
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { appPaths, appRoot, dataPaths, localAppData, taskFolderName, taskLayout } from '../../app/paths.mjs'
import { prepareTask, RECEIVED_NAME } from '../../app/workspace/index.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { createKeyring } from '../../app/models/keys.mjs'

function scratch() {
  return mkdtempSync(join(tmpdir(), 'sidemate-paths-'))
}

// 假加密：异或一下，够测试用（跟 test/models/keys.test.mjs 一个路子）
function xor() {
  return {
    available: () => true,
    encrypt(text) {
      const buf = Buffer.from(text, 'utf8')
      for (let i = 0; i < buf.length; i++) buf[i] ^= 0x5a
      return buf
    },
    decrypt(buf) {
      const copy = Buffer.from(buf)
      for (let i = 0; i < copy.length; i++) copy[i] ^= 0x5a
      return copy.toString('utf8')
    },
  }
}

test('程序数据都在 %LOCALAPPDATA%\\sidemate 底下，名字全是英文', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }
  assert.equal(localAppData(env), 'C:\\Users\\test\\AppData\\Local')
  assert.equal(appRoot(env), join('C:\\Users\\test\\AppData\\Local', 'sidemate'))
  // 没有 LOCALAPPDATA 就退回本机数据目录，不去别处找
  assert.equal(localAppData({}), join(homedir(), 'AppData', 'Local'))
})

test('每个位置各归各家：模型、能力、外部工具、同意记录、目录', () => {
  const root = 'C:\\data\\sidemate'
  const paths = appPaths(root)
  assert.equal(paths.model, join(root, 'model.json'))
  assert.equal(paths.ability, join(root, 'ability.json'))
  assert.equal(paths.mcp, join(root, 'mcp.json'))
  assert.equal(paths.agreement, join(root, 'useragreement.json'))
  assert.equal(paths.settings, join(root, 'data', 'settings.json'))
  assert.equal(paths.skills, join(root, 'skills'))
  assert.equal(paths.tasks, join(root, 'tasks'))
  assert.equal(paths.news, join(root, 'news'))
  assert.equal(paths.dsh, join(root, 'dsh'))
  assert.equal(paths.temp, join(root, 'temp'))
  assert.equal(paths.electron, join(root, 'electron'))
  // 日志、用量这些零碎在 data\ 下
  const data = dataPaths(root)
  assert.equal(data.taskLog, join(root, 'data', 'task.log'))
  assert.equal(data.settingsLog, join(root, 'data', 'settings.log'))
  assert.equal(data.petLog, join(root, 'data', 'pet.log'))
  assert.equal(data.newsLog, join(root, 'data', 'news.log'))
  assert.equal(data.usage, join(root, 'data', 'usage.json'))
  assert.equal(data.recent, join(root, 'data', 'recent.json'))
  // 一个位置只在这里定一次：别的模块不许自己拼
  assert.equal(paths.root, root)
})

test('任务文件夹的名字：年月日时分 + 两位随机数，14 位数字', () => {
  const now = new Date(2026, 10, 16, 19, 30, 42)
  const name = taskFolderName(now, () => 0.42)
  assert.equal(name, '20261116193042')
  assert.match(name, /^\d{14}$/)
  // 随机数不足两位补零
  assert.equal(taskFolderName(now, () => 0.05).endsWith('05'), true)
  // 任务文件夹里的三样：用户文件的副本、过程文件、对话记录
  const layout = taskLayout('C:\\data\\sidemate\\tasks\\20261116193042')
  assert.equal(layout.received, join('C:\\data\\sidemate\\tasks\\20261116193042', RECEIVED_NAME))
  assert.equal(layout.process, join('C:\\data\\sidemate\\tasks\\20261116193042', '.sidemate'))
  assert.equal(layout.conversation, join('C:\\data\\sidemate\\tasks\\20261116193042', '.sidemate', 'conversation.json'))
})

test('两个任务撞了文件夹名：重摇那两位随机数', () => {
  const root = scratch()
  try {
    const now = new Date(2026, 10, 16, 19, 30, 42)
    let calls = 0
    // 第一次摇出 42，第二次还是 42（撞名），第三次换成 77
    const random = () => {
      calls += 1
      return calls <= 2 ? 0.42 : 0.77
    }
    const first = prepareTask({ root, now, random })
    const second = prepareTask({ root, now, random })
    assert.equal(basename(first.workspace), '20261116193042')
    assert.equal(basename(second.workspace), '20261116193077')
    assert.notEqual(first.workspace, second.workspace)
    // 两个都在 tasks\ 下面
    assert.equal(dirname(first.workspace), appPaths(root).tasks)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function basename(path) {
  return String(path).split(/[\\/]/).pop()
}
function dirname(path) {
  return String(path).replace(/[\\/][^\\/]+$/, '')
}

test('历史从任务文件夹里扫出来：删了文件夹，那条历史就没了', () => {
  const root = scratch()
  try {
    const paths = appPaths(root)
    mkdirSync(paths.tasks, { recursive: true })
    const taskDir = join(paths.tasks, '20261116193042')
    mkdirSync(join(taskDir, '.sidemate'), { recursive: true })
    const history = createHistory({ tasksDir: paths.tasks, newsDir: paths.news })
    history.start({ workspace: taskDir, prompt: '把这份合同改一下' })
    const listed = history.list()
    assert.equal(listed.length, 1)
    // 标题从记录里取，不看文件夹名
    assert.equal(listed[0].title, '把这份合同改一下')
    // 记录就在任务文件夹自己的 .sidemate 里
    assert.ok(existsSync(join(taskDir, '.sidemate', 'conversation.json')))
    // 用户把任务文件夹删了，历史里就没了这条
    rmSync(taskDir, { recursive: true, force: true })
    assert.deepEqual(history.list(), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('密钥在 model.json 里来回：文件里只有密文，没有明文', () => {
  const root = scratch()
  try {
    const paths = appPaths(root)
    mkdirSync(paths.root, { recursive: true })
    // 先写一份清单，里面有一条自定义模型
    writeFileSync(paths.model, JSON.stringify({
      version: 1,
      default: { entry: 'c-demo' },
      entries: [{ id: 'c-demo', name: 'demo', kind: 'custom', protocol: 'openai', baseUrl: 'https://api.example.com', models: [{ id: 'demo-model', name: 'M' }] }],
    }, null, 2), 'utf8')
    const keyring = createKeyring({ root, crypto: xor() })
    const saved = keyring.save('c-demo', 'demo-key-value')
    assert.equal(saved.ok, true)
    // model.json 里存的是密文：条目上的 sealed 字段，没有明文
    const raw = JSON.parse(readFileSync(paths.model, 'utf8'))
    const entry = raw.entries.find((one) => one.id === 'c-demo')
    assert.equal(typeof entry.sealed, 'string')
    assert.ok(entry.sealed.length > 0)
    assert.equal(readFileSync(paths.model, 'utf8').includes('demo-key-value'), false)
    // 再读回来：还是那把钥匙
    assert.equal(keyring.read('c-demo'), 'demo-key-value')
    assert.equal(keyring.has('c-demo'), true)
    // 没有「钥匙\」目录这回事
    assert.equal(existsSync(join(paths.root, '钥匙')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('用户拖进来的文件拷进任务文件夹的 received\\，成品根目录留着', () => {
  const root = scratch()
  try {
    const source = scratch()
    try {
      writeFileSync(join(source, '合同.docx'), 'hello', 'utf8')
      const prepared = prepareTask({ root, paths: [join(source, '合同.docx')] })
      // 副本在 received\ 里
      assert.equal(prepared.copied.length, 1)
      assert.ok(prepared.copied[0].to.endsWith(join(RECEIVED_NAME, '合同.docx')))
      assert.ok(existsSync(join(prepared.workspace, RECEIVED_NAME, '合同.docx')))
      // 成品留在任务文件夹根目录：没有「桌伴输出」那一层了
      assert.equal(prepared.outputDir, undefined)
    } finally {
      rmSync(source, { recursive: true, force: true })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
