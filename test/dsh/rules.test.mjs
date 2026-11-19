import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { dshLaunch, payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-test-key'
const layout = payloadLayout()
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function ensureNode() {
  if (existsSync(layout.node)) return
  mkdirSync(join(layout.root, 'node'), { recursive: true })
  copyFileSync(process.execPath, layout.node)
  chmodSync(layout.node, 0o755)
}

function taskOptions(extra) {
  const workspace = scratch('sidemate-ws-')
  const lowRoot = scratch('sidemate-low-')
  return { workspace, lowRoot, ...extra }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

const RULE_HEAD = '桌伴的干活规矩：'
const RULE_TWO = '2. 用户给的文件是当资源链接发给你的：'
const RULE_THREE = '3. 改已有的脚本或文本文件用 edit 工具。'
const RULE_OUT = '成品默认写在这个任务文件夹的根目录'
const CHINESE_PROBE = '中文测试一二三'
const RULE_FILE = new URL('../../app/dsh/rules.patch.yml', import.meta.url)

function toolResultText(body) {
  const parts = []
  for (const message of body?.messages || []) {
    const content = message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type !== 'tool_result') continue
      if (typeof block.content === 'string') parts.push(block.content)
      else if (Array.isArray(block.content)) {
        for (const piece of block.content) if (typeof piece?.text === 'string') parts.push(piece.text)
      }
    }
  }
  return parts.join('\n')
}

function pythonPathFrom(text) {
  const full = text.match(/[A-Za-z]:[\\/][^\s"'<>|]*?python\.exe/i)
  if (full) return full[0]
  const loose = text.match(/[^\s"'<>|]*python\.exe/i)
  return loose ? loose[0] : ''
}

describe('dsh rules', { concurrency: 1 }, () => {
  test('the persona prefix is empty: the coding agent line is gone from the patch', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    assert.match(text, /personaPrefix: ''/, text)
    assert.equal(/coding agent/i.test(text), false, text)
  })

  test('the rules no longer talk about scanning, fonts or the shell checking the file', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    // 扫描件转图、字体整理、交稿体检、出处标记：桌伴不再管，规矩里也不提了
    assert.equal(text.includes('扫描页转成图'), false, text)
    assert.equal(text.includes('桌伴已经把扫描页转成图'), false, text)
    assert.equal(text.includes('桌伴会统一整理字体'), false, text)
    assert.equal(text.includes('桌伴交稿前会检查'), false, text)
    assert.equal(text.includes('打不开的不算成品'), false, text)
    assert.equal(text.includes('fontTable'), false, text)
    assert.equal(text.includes('这一处没认出来'), false, text)
  })

  test('the rules do not tell the model it cannot see pictures', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    // 能看图的模型（deepseek-flash、勾了「支持图片输入」的自定义模型）看到这句就不去读用户发的图了
    assert.equal(text.includes('看不了图片'), false, text)
    assert.equal(text.includes('看不了图'), false, text)
    // 「不许渲染自检」这句删了：模型不用再自己渲染一遍检查
    assert.equal(text.includes('自己生成的文件不要为了检查效果去渲染预览图'), false, text)
    assert.equal(text.includes('渲染'), false, text)
  })

  test('the rules keep the products in the task folder: no output folder, no draft folder', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    // 成品就在任务文件夹根目录：桌伴不再拷一层
    assert.ok(text.includes(RULE_OUT), text)
    // 过程文件在 .sidemate\，用户给的文件在 received\ 且只读
    assert.ok(text.includes('.sidemate\\'), text)
    assert.ok(text.includes('received\\'), text)
    assert.ok(text.includes('只读'), text)
    // 交稿用 present
    assert.ok(text.includes('调用 present 交稿'), text)
    // 旧的两层没了
    assert.equal(text.includes('桌伴输出'), false, text)
    assert.equal(text.includes('.草稿/'), false, text)
    assert.equal(text.includes('.草稿\\'), false, text)
  })

  test('the rules say the files come in as resource links', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    assert.ok(text.includes('资源链接'), text)
    assert.ok(text.includes('file://'), text)
    // 读文件用 name（相对路径），uri 是百分号编码的地址，不是路径
    assert.ok(text.includes('name 是它在任务文件夹里的相对路径'), text)
    assert.ok(text.includes('百分号编码'), text)
    assert.ok(text.includes('不要拿 uri 去读文件'), text)
  })

  test('the rules do not teach the model to turn a uri into a path', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    // 教模型自己转 uri 会拿到 %E8%8C%83 这种编码路径，读不到文件
    assert.equal(text.includes('去掉 file://'), false, text)
    assert.equal(text.includes('把开头的 / 去掉'), false, text)
    assert.equal(text.includes('对应 C:/'), false, text)
  })

  test('the rules forbid bracket placeholders in the finished document', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    assert.ok(text.includes('不要留 [20XX]年[月][日]'), text)
    assert.ok(text.includes('先在回话里问一句'), text)
    assert.ok(text.includes('日期用当天的日期'), text)
  })

  test('office files have to be real: no renamed scripts, scripts go to the process folder', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    assert.ok(text.includes('openpyxl'), text)
    assert.ok(text.includes('python-docx'), text)
    assert.ok(text.includes('python-pptx'), text)
    assert.ok(text.includes('不要把脚本改成'), text)
    assert.ok(text.includes('.sidemate\\'), text)
  })

  test('the rules use the bundled python and read pdf with pypdf', () => {
    const text = readFileSync(RULE_FILE, 'utf8')
    assert.ok(text.includes('直接用 python 命令'), text)
    assert.ok(text.includes('不要 pip install'), text)
    assert.ok(text.includes('pypdf'), text)
  })

  test('the launch env pins python output to utf-8', () => {
    const launch = dshLaunch(taskOptions({ taskId: 'env', apiKey: KEY, prompt: 'hi', workspace: scratch('sidemate-ws-') }))
    assert.equal(launch.env.PYTHONIOENCODING, 'utf-8')
    assert.equal(launch.env.PYTHONUTF8, '1')
  })

  test('the dumped config carries the persona and the rules', { timeout: 60_000 }, () => {
    ensureNode()
    assert.equal(existsSync(layout.dsh), true)
    const options = taskOptions({ taskId: 'dump', apiKey: KEY, prompt: 'hi', workspace: scratch('sidemate-ws-') })
    const launch = dshLaunch(options)
    const dumped = spawnSync(launch.command, [...launch.args, '--dump-config'], {
      cwd: launch.cwd,
      env: launch.env,
      encoding: 'utf8',
      timeout: 40_000,
    })
    const text = `${dumped.stdout}\n${dumped.stderr}`
    assert.equal(dumped.status, 0, text)
    // 人设那行显式写成空串：dsh 自带的「You are a coding agent ...」不许留在提示里
    assert.match(text, /personaPrefix: ''/, text.slice(0, 2000))
    assert.equal(/coding agent/i.test(text), false, text.slice(0, 2000))
    assert.ok(text.includes(RULE_HEAD), text.slice(0, 2000))
    // the yaml dump wraps long lines, so compare with the whitespace flattened
    const flat = text.replace(/\s+/g, ' ')
    assert.ok(flat.includes(RULE_TWO), text.slice(-2000))
    assert.ok(flat.includes(RULE_THREE), text.slice(-2000))
  })

  test('python output through the pwsh tool keeps its chinese', { timeout: 90_000 }, async (t) => {
    if (process.platform !== 'win32') {
      t.skip('the pwsh tool check only runs on windows')
      return
    }
    ensureNode()
    if (!existsSync(join(layout.python, 'runtime.json'))) {
      t.skip('bundled python is not installed')
      return
    }
    let firstRequestError = null
    let python = ''
    let pwshOutput = ''
    const fake = await startFake({
      expectKey: KEY,
      respond: (body, nth) => {
        if (nth === 1) {
          try {
            const system = JSON.stringify(body.system)
            assert.ok(system.includes(RULE_HEAD), system.slice(0, 2000))
            assert.ok(system.includes(RULE_TWO), system.slice(0, 2000))
          } catch (error) {
            firstRequestError = error
          }
          return { kind: 'tool', name: 'load_workspace_dependencies', input: {} }
        }
        if (nth === 2) {
          const text = toolResultText(body)
          python = pythonPathFrom(text)
          if (!python) {
            firstRequestError = firstRequestError ?? new Error(`no python.exe in the workspace tool result: ${text.slice(0, 800)}`)
            return { kind: 'text', text: '好了' }
          }
          return {
            kind: 'tool',
            name: 'pwsh',
            input: {
              description: '打印一句中文',
              command: `& '${python}' -c "print('${CHINESE_PROBE}')"`,
            },
          }
        }
        pwshOutput = toolResultText(body)
        return { kind: 'text', text: '好了' }
      },
    })
    const events = []
    try {
      const end = await runTask({
        ...taskOptions({ taskId: 'rules', apiKey: KEY, prompt: '准备', baseUrl: fake.url }),
        onEvent: (event) => events.push(event),
      }).done
      assert.equal(end.status, 'done', JSON.stringify(events))
      if (firstRequestError) throw firstRequestError
      assert.ok(python, 'the workspace tool never reported a python.exe')
      assert.ok(pwshOutput.includes(CHINESE_PROBE), pwshOutput.slice(0, 1500))
      assert.equal(pwshOutput.includes('\uFFFD'), false, pwshOutput.slice(0, 1500))
    } finally {
      await fake.close()
    }
  })
})
