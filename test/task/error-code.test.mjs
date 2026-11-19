// 停工类报错的码（Si）：哪种停工是哪个码、停工那一行的样子、日志里那一行。
// 码表和停工那句在 app/copy/errors.mjs；这几条不碰网络、不起 dsh：
// 模型算不通和沙箱贴不上标签这两条最常见，各测一遍。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { codeFor, codeLine, codeOf, dshOutcome, errorCodeLine, errorText, httpOf, isCode, reasonForDsh, scrub, statusOf, stopText } from '../../app/task/codes.mjs'
// 拼那一行、截 80 个字只写在 app/copy/line.mjs（唯一一份）
import { codeTail, errorLineText, rawText } from '../../app/copy/line.mjs'
import { createRunner } from '../../app/task/run.mjs'
import { createTask, reduceTask } from '../../app/task/state.mjs'
import { waitHead } from '../../app/task/wait.mjs'
import { t } from '../../app/copy/copy.mjs'
import { toTaskView } from '../../app/task/view.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

test('reason 换码：桌伴自己查出来的有固定的码，模型服务回的照 HTTP 码', () => {
  assert.equal(codeFor('consent'), 'Si102')
  assert.equal(codeFor('missing'), 'Si103')
  assert.equal(codeFor('crash'), 'Si301')
  assert.equal(codeFor('toolcall'), 'Si302')
  assert.equal(codeFor('noreply'), 'Si303')
  assert.equal(codeFor('badreply'), 'Si305')
  assert.equal(codeFor('network'), 'Si601')
  assert.equal(codeFor('locked'), 'Si803')
  // 桌伴自己掐表停工（Si304）、盯原件变没变（Si802）都删了
  assert.equal(codeFor('stall'), '')
  assert.equal(codeFor('changed'), '')
  assert.equal(codeFor('other'), 'Si901')
  assert.equal(codeFor('没这个'), '')
  // 模型服务回的：HTTP 码在码表里就直接用
  assert.equal(codeFor('key', '401 Unauthorized: invalid api key'), 'Si401')
  assert.equal(codeFor('key', 'MISSING_CREDENTIAL for provider deepseek'), 'Si101')
  assert.equal(codeFor('quota', '402 Insufficient Balance'), 'Si402')
  assert.equal(codeFor('busy', '429 Too Many Requests'), 'Si429')
  assert.equal(codeFor('busy', 'HTTP 503 Service Unavailable'), 'Si503')
  // 不拿英文原文猜了：没有 HTTP 码就当忙（模型请求的错照 dsh 给的码，见下面那几个测试）
  assert.equal(codeFor('busy', 'overloaded_error'), 'Si429')
  assert.equal(codeFor('noreply', 'request timeout 408'), 'Si408')
  assert.equal(codeFor('other', 'status 413 request too large'), 'Si413')
  assert.equal(httpOf('no number here'), 0)
})

test('停工那一行：停工那句 · Si 码 错误，原文（原文截到 80 个字，没有原文只到「错误」）', () => {
  assert.equal(errorLineText('模型请求失败，已保存执行进度', 'Si429', 'Rate limit reached for requests'), '模型请求失败，已保存执行进度 · Si429 错误，Rate limit reached for requests')
  assert.equal(errorLineText('干活的程序没起来', 'Si301'), '干活的程序没起来 · Si301 错误')
  assert.equal(codeTail('Si301'), '· Si301 错误')
  assert.equal(codeTail(''), '')
  // 截了的末尾补「…」，看得出后面还有；没截的不补
  const long = 'x'.repeat(200)
  assert.equal(rawText(long), `${'x'.repeat(80)}…`)
  assert.equal(rawText('x'.repeat(80)), 'x'.repeat(80))
  assert.equal(rawText('  a\n  b  '), 'a b')
  assert.equal(isCode('Si101'), true)
  assert.equal(isCode('E101'), false)
  assert.equal(isCode('Si999'), false)
})

test('码表里没有的 HTTP 码：照样写成 Si + 那个码，停下那句说「模型请求失败」，不落 Si901', () => {
  assert.equal(httpOf('418 I am a teapot'), 418)
  assert.equal(codeFor('other', '418 I am a teapot'), 'Si418')
  assert.equal(stopText({ reason: 'other', raw: '418 I am a teapot' }), '模型请求失败，已保存执行进度')
  assert.equal(
    errorLineText(stopText({ reason: 'other', raw: '418 I am a teapot' }), 'Si418', '418 I am a teapot'),
    '模型请求失败，已保存执行进度 · Si418 错误，418 I am a teapot',
  )
  // 码表里有的照旧用码表里的那个
  assert.equal(codeFor('other', 'status 413 request too large'), 'Si413')
  assert.equal(httpOf('no number here'), 0)
})

test('停工那句：忙就是忙，事件点名了就用点名的', () => {
  assert.equal(stopText({ reason: 'busy' }), '模型忙，已保存执行进度')
  assert.equal(stopText({ reason: 'busy', biz: 1302 }), '模型忙，已保存执行进度')
  assert.equal(stopText({ reason: 'busy', free: true }), '模型忙，已保存执行进度')
  assert.equal(stopText({ reason: 'noreply' }), '模型响应超时，已保存执行进度')
  assert.equal(stopText({ reason: 'badreply' }), '模型响应无效，已保存执行进度')
  assert.equal(stopText({ reason: 'locked', name: '周报.docx' }), '文件被锁定：周报.docx')
  assert.equal(stopText({ reason: 'crash' }), '程序崩溃')
  // 事件里自带码表里的码就用它
  assert.equal(codeOf({ reason: 'other', code: 'Si206' }), 'Si206')
})

test('模型请求的错：dsh 的码和 HTTP 状态，显示成「停下那句 · dsh 码 状态，原文」', () => {
  const event = { type: 'error', reason: 'busy', dshCode: 'RATE_LIMIT', status: 429, raw: 'Too Many Requests' }
  assert.equal(codeOf(event), 'RATE_LIMIT 429')
  assert.equal(stopText(event, codeOf(event)), '模型忙，已保存执行进度')
  assert.equal(codeTail(codeOf(event), event.raw), '· RATE_LIMIT 429，Too Many Requests')
  // 没有状态：就只有码
  assert.equal(codeOf({ dshCode: 'EMPTY_RESPONSE' }), 'EMPTY_RESPONSE')
  assert.equal(stopText({ dshCode: 'EMPTY_RESPONSE' }, 'EMPTY_RESPONSE'), '模型请求失败，已保存执行进度')
  // dsh 的各种码 → 停下那句
  assert.equal(stopText({ dshCode: 'AUTH', status: 401 }), '密钥无效')
  assert.equal(stopText({ dshCode: 'TRANSPORT' }), '模型连接中断，已保存执行进度')
  assert.equal(stopText({ dshCode: 'TIMEOUT' }), '模型响应超时，已保存执行进度')
  assert.equal(stopText({ dshCode: 'SERVER', status: 503 }), '模型请求失败，已保存执行进度')
  assert.equal(stopText({ dshCode: 'MISSING_CREDENTIAL' }), '密钥未填写')
  // 免费通道的 401：不是用户的钥匙不对，说「模型请求失败」
  assert.equal(stopText({ dshCode: 'AUTH', status: 401, route: 'kilo' }), '模型请求失败，已保存执行进度')
  // 桌伴自己的错照旧用 Si 码
  assert.equal(codeOf({ reason: 'crash' }), 'Si301')
})

test('模型请求的错：横幅上带的是 dsh 的码，后面那截灰字也照它拼', () => {
  let state = createTask()
  state = { ...state, runId: 'r1', phase: 'working', round: 1 }
  const step = reduceTask(state, { type: 'error', reason: 'busy', dshCode: 'RATE_LIMIT', status: 429, raw: 'Too Many Requests', taskId: 'r1' })
  const item = step.state.flow.find((one) => one.kind === 'error')
  assert.ok(item, '没有报错那一行')
  assert.equal(item.text, '模型忙，已保存执行进度')
  assert.equal(item.code, 'RATE_LIMIT 429')
  const block = toTaskView(step.state, { root: '' }).banner
  assert.equal(block.code, 'RATE_LIMIT 429')
  assert.equal(codeTail(block.code, block.raw), '· RATE_LIMIT 429，Too Many Requests')
  // 日志里那一行：码、HTTP 状态、原文
  const line = errorCodeLine({ reason: 'busy', dshCode: 'RATE_LIMIT', status: 429, raw: 'Too Many Requests' })
  assert.equal(line.code, 'RATE_LIMIT 429')
  assert.equal(line.http, 429)
})

test('日志那一行：码 + 哪一步 + 细节，HTTP 码、原文全文都记，钥匙不写进去', () => {
  const one = codeLine('Si301', 'crash', 'dsh exit 5: access denied', { exitCode: 5 })
  assert.equal(one.code, 'Si301')
  assert.equal(one.step, 'crash')
  assert.match(one.detail, /exit 5/)
  assert.equal(one.exitCode, 5)
  const key = scrub('sk-abcdef1234567890 贴错了')
  assert.ok(!key.includes('abcdef1234567890'), '钥匙漏进日志了')
  assert.match(key, /\*\*\*/)
  const raw = `429 Too Many Requests {"error":{"code":1302,"message":"${'并发'.repeat(100)}"}}`
  const line = errorCodeLine({ reason: 'busy', raw })
  assert.equal(line.code, 'Si429')
  assert.equal(line.http, 429)
  assert.ok(line.raw.length > 200, '原文全文记进日志')
})

// 界面那一行：停工那句，码和原文在后面那截灰字
test('报错那行：停工那句 + 码 + 原文', () => {
  let state = createTask()
  state = { ...state, runId: 'r1', phase: 'working', round: 1 }
  const step = reduceTask(state, { type: 'error', reason: 'key', raw: '401 Unauthorized: Authentication Fails', taskId: 'r1' })
  const item = step.state.flow.find((one) => one.kind === 'error')
  assert.ok(item, '没有报错那一行')
  // Si401 说「密钥无效」（errors.mjs 码表，跟设置里测试同一句），不再笼统说模型请求失败
  assert.equal(item.text, '密钥无效')
  assert.equal(item.code, 'Si401')
  assert.equal(item.raw, '401 Unauthorized: Authentication Fails')
  // 页面不在对话流里画它，画成输入框上方的红色横幅（报错级）\n  const view = toTaskView(step.state, { root: '' })\n  assert.equal(view.blocks.some((one) => one.kind === 'error'), false)\n  const block = view.banner\n  assert.equal(block.level, 'block')\n  assert.equal(block.code, 'Si401')\n  assert.equal(codeTail(block.code, block.raw), '· Si401 错误，401 Unauthorized: Authentication Fails')
})

// 一份最简的壳：只够走到开工前那几步（模型算不通、任务文件夹建不起来）
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-code-'))
  const seen = { log: [] }
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => (over.model ? over.model() : { ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm' }, vendor: 'v', free: false }),
    log: (event, data) => seen.log.push([event, data]),
    prepareTask: over.prepareTask || (() => {
      const workspace = join(root, 'ws')
      mkdirSync(workspace, { recursive: true })
      return { kind: 'files', workspace, outputDir: join(root, 'out'), copied: [], skipped: [], snapshot: [] }
    }),
    snapshotWorkspace: () => [],
    runTask: (options) => ({ sessionId: 's1', cancel() {}, done: Promise.resolve({ type: 'end', taskId: options.taskId, status: 'done' }) }),
  })
  return { runner, seen, root }
}

async function until(predicate) {
  for (let i = 0; i < 400 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), '没等到')
}

test('模型算不通：界面有码，task.log 里有一行码和细节', async () => {
  const h = harness({ model: () => ({ ok: false, reason: 'key', code: 'Si101', stop: 'noKey', vars: { vendor: 'DeepSeek' }, message: '还没填 DeepSeek 的密钥' }) })
  h.runner.feed({ type: 'send', text: '写个周报', runId: 'r1' })
  await until(() => h.runner.view().phase === 'error')
  const block = h.runner.view().banner
  assert.equal(block.code, 'Si101')
  assert.equal(block.text, 'DeepSeek 密钥未填写')
  assert.equal(block.raw, '', '桌伴自己的错没有原文')
  const line = h.seen.log.find(([event]) => event === 'error-code')
  assert.ok(line, '日志里没有 error-code 那一行')
  assert.equal(line[1].code, 'Si101')
  assert.match(line[1].detail, /密钥/)
})

test('不能在原件所在的文件夹里干活：真走到了算没归上类的（Si901），不再有自己的码', async () => {
  const h = harness({
    prepareTask: () => { throw new Error('cannot work in the folder of the originals') },
  })
  h.runner.feed({ type: 'send', text: '写个周报', runId: 'r9' })
  await until(() => h.runner.view().phase === 'error')
  const block = h.runner.view().banner
  assert.equal(block.code, 'Si901')
  assert.equal(block.text, '未知错误')
  assert.equal(isCode('Si205'), false)
  const line = h.seen.log.find(([event]) => event === 'error-code')
  assert.ok(line, '日志里没有 error-code 那一行')
  assert.equal(line[1].code, 'Si901')
  assert.match(line[1].detail, /folder of the originals/)
})

test('界面上显示的报错都带 Si 码：粘贴、打开对话、装能力', () => {
  // 停下那句照码表查，拼成「那句 · Si 码 错误」
  assert.equal(errorText('Si702'), '图片格式不支持 · Si702 错误')
  assert.equal(errorText('Si704'), '粘贴失败 · Si704 错误')
  assert.equal(errorText('Si902'), '对话打开失败 · Si902 错误')
  assert.equal(errorText('Si906'), '安装失败 · Si906 错误')
  // 有原文的带原文（装能力失败的原因也当原文）
  assert.equal(errorText('Si906', 'GitHub 连接失败'), '安装失败 · Si906 错误，GitHub 连接失败')
  // 码表里没有的码：停下那句说「模型请求失败」
  assert.equal(errorText('Si418'), '模型请求失败，已保存执行进度 · Si418 错误')
  assert.equal(errorText(''), '')
})

test('码表：删掉的码不在了', () => {
  for (const code of ['Si702', 'Si704', 'Si902', 'Si906']) {
    assert.equal(isCode(code), true, `${code} 不在码表里`)
  }
  // 并进别的码、或者整条删掉的（Si201–Si203：桌伴不再自己降权限，只靠 dsh 的沙箱）
  for (const code of ['Si201', 'Si202', 'Si203', 'Si204', 'Si205', 'Si304', 'Si802', 'Si804', 'Si905', 'Si703', 'Si903', 'Si904']) assert.equal(isCode(code), false, code)
  // 对话记录不存在、任务文件夹不存在：状态码 St802 / St803
  assert.equal(t('St802'), '对话记录不存在')
  assert.equal(t('St803'), '任务文件夹不存在')
})
test('输入框上方那一条：报错和提示都有时只给报错；提示点 × 或发下一句就收起', () => {
  let state = reduceTask(createTask(), { type: 'send', text: '写周报', runId: 'n1' }).state
  // 不停工的错（贴的图格式不对）：提示级，灰色一行
  state = reduceTask(state, { type: 'paste', files: [], code: 'Si702' }).state
  assert.deepEqual(toTaskView(state).banner, { level: 'notice', text: '图片格式不支持', code: 'Si702', raw: '', buttons: [] })
  // 这一轮又停了：只给报错
  const stopped = reduceTask(state, { type: 'error', reason: 'crash', taskId: 'n1' }).state
  const banner = toTaskView(stopped).banner
  assert.deepEqual([banner.level, banner.text, banner.code], ['block', '程序崩溃', 'Si301'])
  // 点重来：横幅和提示都收起
  const again = reduceTask(stopped, { type: 'retry', runId: 'n2' }).state
  assert.equal(toTaskView(again).banner, null)
  // 提示点 × 收起
  const done = reduceTask(reduceTask(state, { type: 'end', taskId: 'n1', status: 'done' }).state, { type: 'dismiss' }).state
  assert.equal(toTaskView(done).banner, null)
})

test('dsh 给了失败那一行：HTTP 状态只信它给的，没有就是 0（端口不当状态）', () => {
  // dsh 给了码、没给状态（TRANSPORT 本来就没有 HTTP 响应）：原文里的端口不当状态
  const failure = { code: 'TRANSPORT', status: 0, message: 'connect ECONNREFUSED 1.2.3.4:443' }
  const event = { reason: 'network', dshCode: failure.code, status: statusOf(failure, ''), raw: failure.message }
  assert.equal(event.status, 0)
  assert.equal(codeOf(event), 'TRANSPORT')
  assert.equal(stopText(event), '模型连接中断，已保存执行进度')
  const line = errorCodeLine(event)
  assert.equal(line.code, 'TRANSPORT')
  assert.equal(line.http, undefined, '没有 HTTP 状态就不写')
  // dsh 给了状态就照它的
  assert.equal(statusOf({ code: 'RATE_LIMIT', status: 429, message: 'Too Many Requests' }, ''), 429)
  // dsh 没给失败那一行（桌伴自己的错）：还是从原文里取
  assert.equal(statusOf(null, '418 I am a teapot'), 418)
})

test('免费通道的 401：停下那句说「模型请求失败」，横幅只给「重来」', () => {
  // 免费通道没有钥匙可填：不是用户的钥匙不对，不该把人引去设置页
  const reason = reasonForDsh('AUTH', 401, 'kilo')
  assert.equal(reason, 'other')
  let state = createTask()
  state = { ...state, runId: 'r1', phase: 'working', round: 1 }
  const step = reduceTask(state, { type: 'error', reason, dshCode: 'AUTH', status: 401, route: 'kilo', raw: '401 Unauthorized', taskId: 'r1' })
  const item = step.state.flow.find((one) => one.kind === 'error')
  assert.ok(item, '没有报错那一行')
  assert.equal(item.text, '模型请求失败，已保存执行进度')
  assert.deepEqual(item.buttons.map((one) => one.action), ['retry'])
  const block = toTaskView(step.state, { root: '' }).banner
  assert.deepEqual(block.buttons.map((one) => one.action), ['retry'])
  // 自己配的密钥不对：还是引去设置页
  assert.equal(reasonForDsh('AUTH', 401, ''), 'key')
})

test('EMPTY_RESPONSE：等待行和停下时说的是一回事', () => {
  const outcome = dshOutcome('EMPTY_RESPONSE')
  assert.equal(outcome.reason, 'server')
  assert.equal(outcome.stop, 'fail')
  // 等待行那行说服务出错，停下那句说请求失败：同一类错，说法一致
  assert.equal(waitHead(outcome.reason), '模型服务出错，')
  assert.equal(stopText({ dshCode: 'EMPTY_RESPONSE' }), '模型请求失败，已保存执行进度')
  assert.equal(stopText({ dshCode: 'EMPTY_RESPONSE' }), stopText({ dshCode: 'SERVER' }))
})
