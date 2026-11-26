// 任务窗页面预览：起 window-main.mjs 截十张图、点一遍按钮，对着 PNG 和 acts.json 断言。
// 没设 SIDEMATE_TASKWIN 就跳过，平时 npm test 不拉起 Electron。
// Windows：$env:SIDEMATE_TASKWIN='1'; $env:SIDEMATE_SHOTS='...'; node --test test/task/window.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { GAP } from '../../app/task/scroll.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..', '..')
const shots = process.env.SIDEMATE_SHOTS || ''

const NAMES = ['1-空的', '2-带了文件还没开始', '3-干活中', '4-等你回话', '5-做完了', '6-没干成', '7-只聊天', '8-回话带格式', '9-两段回答', '10-新任务', '问装不装', '装好了', '历史下拉', '全部对话', '11-输入框120字', '12-拖着文件进窗', '13-发消息前', '14-发消息后', '15-往上翻来新内容', '16-新闻', '17-贴了图和长文字', '18-模型忙等一等', '19-停在这儿', '20-干活中插一句', '23-原件被改了']
// 小签行那两张（小签的场景在 window-tags.mjs 里，截图名排在后面，避开别的场景的号）
const TAG_NAMES = ['21-小签收着', '22-小签展开']
const FOLDER = 'C:/Users/slow/Desktop/本周材料'
const MATS = ['三季度工程进度周报表.xlsx', '本周会议纪要.docx', '数据汇总（含三季度完整口径）.xlsx', '上周周报.docx', '各项目负责人沟通记录.docx', '三季度现场照片说明.docx', '口径备注与勘误.docx'].map((n) => FOLDER + '/' + n)
const CARD = 'C:/Users/slow/桌伴/任务/1104-汇成本周周报/本周周报.docx'

test('task window scenes', { skip: process.env.SIDEMATE_TASKWIN ? false : 'set SIDEMATE_TASKWIN=1', timeout: 180_000 }, async () => {
  assert.equal(shots !== '', true, 'SIDEMATE_SHOTS 未设置')
  const electron = createRequire(join(root, 'package.json'))('electron')
  const lab = mkdtempSync(join(tmpdir(), 'sidemate-taskwin-'))
  const run = (args) => new Promise((resolve) => {
    const child = spawn(electron, [...args, `--user-data-dir=${join(lab, 'user')}`, '--no-sandbox', '--disable-gpu'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => resolve({ code, err }))
  })
  try {
    mkdirSync(shots, { recursive: true })
    const main = await run([join(root, 'test', 'task', 'window-main.mjs')])
    assert.equal(main.code, 0, main.err.slice(-2000))
    const scale = await run(['--force-device-scale-factor=1.5', join(root, 'test', 'task', 'window-main.mjs'), '--only-10'])
    assert.equal(scale.code, 0, scale.err.slice(-2000))

    for (const name of [...NAMES, ...TAG_NAMES]) {
      const file = join(shots, `${name}.png`)
      assert.equal(existsSync(file), true, file)
      assert.equal(statSync(file).size > 0, true, file)
    }
    const record = JSON.parse(readFileSync(join(shots, 'acts.json'), 'utf8'))
    const acts = record.acts.map((one) => one.action)
    const scene = (name) => record.acts.filter((one) => one.scene === name).map((one) => one.action)
    const has = (action) => acts.some((one) => JSON.stringify(one) === JSON.stringify(action))

    assert.equal(record.checks.cleared, true, '回车发送后输入框没清空')
    assert.equal(record.checks.held, '汇成本周周报', 'Shift+回车、组字中回车动了输入框')
    for (const [name, one] of Object.entries(record.layout)) {
      assert.deepEqual(one, { x: 0, y: 0 }, `${name} 窗内容溢出：${JSON.stringify(one)}`)
    }
    assert.equal(acts.filter((one) => one.type === 'send' && one.text === '汇成本周周报').length, 1, 'send 只该发一次')
    assert.equal(acts.filter((one) => one.type === 'send' && one.text === '再补一段').length, 1, '长对话里回车也只发一次')
    assert.equal(has({ type: 'send', text: '汇成本周周报' }), true)
    assert.equal(has({ type: 'stop' }), true)
    assert.equal(has({ type: 'save-as', path: CARD }), true)
    assert.equal(has({ type: 'preview', path: CARD }), true)
    assert.equal(has({ type: 'retry' }), true)
    assert.equal(has({ type: 'settings' }), true)
    assert.equal(has({ type: 'remove', path: MATS[0] }), true)
    assert.equal(has({ type: 'add' }), true)
    // 改成范本 / 改成材料没了：页面不再发 move
    assert.equal(acts.some((one) => one.type === 'move'), false)
    assert.equal(has({ type: 'preview-folder', path: FOLDER }), true)
    assert.equal(has({ type: 'new' }), true)
    // 问装不装：装上、不装两个都发回主进程（看说明全文是页面自己的事）
    assert.deepEqual(scene('问装不装'), [
      { type: 'install-skill', id: 'mindmap-skill' },
      { type: 'install-drop', id: 'mindmap-skill' },
    ])
    // 小签上的菜单：只有去掉
    assert.deepEqual(record.checks.items, ['移除'])
    // 模型说的每一段一个气泡：一轮两段 → 两个气泡
    assert.equal(record.checks.replies, 2, JSON.stringify(record.checks.replies))
    assert.deepEqual(scene('3-干活中'), [{ type: 'steer', text: '只写销售和库存两块就行' }, { type: 'stop' }])
    // 没干成：输入框上方的红色横幅上两个按钮，先后是去设置、重来
    assert.deepEqual(scene('6-没干成'), [{ type: 'settings' }, { type: 'retry' }])
    // 顶上「＋ 新任务」
    assert.deepEqual(scene('10-新任务'), [{ type: 'new' }])

    // 第二轮几条：数都在 checks.json 里，比具体的数
    const measured = JSON.parse(readFileSync(join(shots, 'checks.json'), 'utf8'))
    // 第 1 条：两种窗、发送 / 停下各量一次，#send 和 #input 交集面积 = 0
    assert.deepEqual(Object.keys(measured.overlap).sort(), ['484x718-send', '484x718-stop'])
    for (const key of Object.keys(measured.overlap)) {
      assert.equal(measured.overlap[key].area, 0, `${key}：${JSON.stringify(measured.overlap[key])}`)
      assert.equal(measured.overlap[key].btn, key.endsWith('stop') ? '停止' : '发送', key)
    }
    // 每张截图：看得见的字里没有没填的 {变量}，看得见的按钮都不是空的
    for (const [name, one] of Object.entries(measured.blank)) {
      assert.deepEqual(one, { vars: [], empty: [] }, `${name}：${JSON.stringify(one)}`)
    }
    // 顶栏 48、小签行上沿 46（上下各 10 + 小签 26）；输入胶囊收起 42、展开三行 ≥ 100
    assert.equal(measured.sizes.withFiles.top, 48, JSON.stringify(measured.sizes))
    assert.equal(measured.sizes.withFiles.tags, 46, JSON.stringify(measured.sizes))
    assert.ok(measured.sizes.withFiles.box >= 100, `输入胶囊展开不够三行：${JSON.stringify(measured.sizes)}`)
    assert.equal(measured.sizes.empty.box, 42, `输入胶囊没收成一行的胶囊：${JSON.stringify(measured.sizes)}`)
    assert.equal(measured.sizes.withFiles.tagHidden, false)
    assert.equal(measured.sizes.empty.tagHidden, true)
    // 第 2 条 b：展开 / 收起的过渡——两种状态圆角都 20、底边不动、发送钮贴框右下角不挪窝、展开途中真在走
    const anim = measured.inputAnim
    assert.ok(anim, 'checks.json 里没有 inputAnim')
    assert.equal(anim.fold.radius, '20px', JSON.stringify(anim))
    assert.equal(anim.open.radius, '20px', JSON.stringify(anim))
    assert.equal(anim.fold2.radius, '20px', JSON.stringify(anim))
    assert.equal(anim.open.bottom, anim.fold.bottom, `展开时底边动了：${JSON.stringify(anim)}`)
    assert.equal(anim.fold2.bottom, anim.fold.bottom, `收起时底边动了：${JSON.stringify(anim)}`)
    assert.ok(anim.open.h >= 100, `展开没到三行：${JSON.stringify(anim)}`)
    assert.equal(anim.fold2.h, 42, `没收回一行的胶囊：${JSON.stringify(anim)}`)
    assert.ok(Math.abs(anim.open.db - anim.fold.db) <= 2, `发送钮离底边的距离变了：${JSON.stringify(anim)}`)
    assert.ok(Math.abs(anim.open.dr - anim.fold.dr) <= 2, `发送钮离右边的距离变了：${JSON.stringify(anim)}`)
    assert.ok(anim.mid.h > 42, `展开是一下跳出来的：${JSON.stringify(anim)}`)
    assert.ok(anim.mid.h < anim.open.h, `展开没有过渡：${JSON.stringify(anim)}`)
    // 第 3 条：不带 preload 的窗里点一遍、拖一遍，console 里 0 条 error
    assert.equal(measured.noPreload.errors, 0, JSON.stringify(measured.noPreload.logs))
    // 第 4 条 a：「▾」开着时来新视图不收；干活中「看全部…」也能点（那条在后台接着跑）、下拉还开着
    assert.equal(measured.menu.opened, false, JSON.stringify(measured.menu))
    assert.equal(measured.menu.seeAll, false, JSON.stringify(measured.menu))
    assert.equal(measured.menu.busy, false, JSON.stringify(measured.menu))
    assert.equal(measured.menu.stillOpen, false, JSON.stringify(measured.menu))
    // 「历史下拉」点一行：主进程真收到 task:history-open，第一条是今天 10:24 那条
    assert.equal(measured.historyOpen, '20261111-102400-001', JSON.stringify(measured.historyOpen))
    // 「全部对话」页：没有「所有文件夹 ▾」，分段和搜索框还在；搜文件夹名能搜到那条
    assert.ok(measured.allpage, 'checks.json 里没有 allpage')
    assert.equal(measured.allpage.folderFilter, 0, JSON.stringify(measured.allpage))
    assert.equal(measured.allpage.segCount, 3, JSON.stringify(measured.allpage))
    assert.equal(measured.allpage.segLeft, measured.allpage.searchLeft, '分段没和搜索框左边对齐：' + JSON.stringify(measured.allpage))
    assert.ok(measured.allpage.segWidth < measured.allpage.searchWidth, '分段被拉得和搜索框一样宽：' + JSON.stringify(measured.allpage))
    assert.equal(measured.allpage.placeholder, '搜索', JSON.stringify(measured.allpage))
    assert.equal(measured.allpage.folderSearchRows, 1, JSON.stringify(measured.allpage))
    assert.deepEqual(measured.allpage.folderSearchTitles, ['帮我形成文献综述'], JSON.stringify(measured.allpage))
    // 第 4 条 b：连推同一个视图时真按鼠标，只收一条
    assert.deepEqual(measured.openClicks, [{ type: 'save-as', path: CARD }])
    assert.deepEqual(measured.stopClicks, [{ type: 'stop' }])
    // 点击区域（真鼠标）：胶囊整块（左缘内 4px、正中、右缘内 4px）都弹历史下拉、
    // 都不发 preview-folder；右边「预览」的小图标才发 preview-folder；
    // 搜框上缘内 2px 点进输入、右键小签弹出菜单
    for (const name of ['left', 'mid', 'right']) {
      const one = measured.hits.capsule[name]
      assert.ok(one, `胶囊 ${name} 没测到：${JSON.stringify(measured.hits)}`)
      assert.equal(one.menu, false, `胶囊 ${name} 没弹出历史下拉：${JSON.stringify(one)}`)
      assert.deepEqual(one.acts, [], `胶囊 ${name} 不该发 preview-folder：${JSON.stringify(one)}`)
      assert.match(one.shadow, /rgb\(34, 32, 28\)/, `胶囊 ${name} 下拉开着时没描深边：${JSON.stringify(one)}`)
    }
    assert.deepEqual(measured.hits.previewbtn, [{ type: 'preview-folder', path: FOLDER }], JSON.stringify(measured.hits.previewbtn))
    assert.equal(measured.hits.menuOpen, false, JSON.stringify(measured.hits))
    // 胶囊：宽 ≥ 120、高 32
    assert.ok(measured.hits.capsuleBox.w >= 120, `胶囊太窄：${JSON.stringify(measured.hits.capsuleBox)}`)
    assert.equal(measured.hits.capsuleBox.h, 32, JSON.stringify(measured.hits.capsuleBox))
    // 五点打点（中心 + 四角内缩 3px）都落在按钮自己身上
    assert.deepEqual(measured.hits.capsuleHit, ['where-btn', 'where-btn', 'where-btn', 'where-btn', 'where-btn'], JSON.stringify(measured.hits.capsuleHit))
    assert.deepEqual(measured.hits.openHit, ['previewbtn', 'previewbtn', 'previewbtn', 'previewbtn', 'previewbtn'], JSON.stringify(measured.hits.openHit))
    // 很长的文件夹名：胶囊不超 240，▾ 还在
    assert.ok(measured.hits.longBox.w <= 240, `胶囊超宽了：${JSON.stringify(measured.hits.longBox)}`)
    assert.ok(measured.hits.longBox.caretW > 0, `▾ 不见了：${JSON.stringify(measured.hits.longBox)}`)
    assert.ok(measured.hits.longBox.caretRight <= measured.hits.longBox.right, `▾ 被挤出去了：${JSON.stringify(measured.hits.longBox)}`)
    assert.equal(measured.hits.searchFocus, true, JSON.stringify(measured.hits))
    assert.equal(measured.hits.tagMenu, false, JSON.stringify(measured.hits))
    // 第 3 条 d：空任务展开后左下角「＋ 文件」：看得见、44×28 以上的点击区整块都是它、鼠标变手；
    // 收起的胶囊里没有它；真点一下发出 add 动作
    const addfile = measured.addfile
    assert.equal(addfile.open.text, '文件', JSON.stringify(addfile))
    assert.equal(addfile.open.hidden, false, JSON.stringify(addfile))
    assert.ok(addfile.open.w >= 44 && addfile.open.h >= 28, `「＋ 文件」点击区不够大：${JSON.stringify(addfile)}`)
    assert.equal(addfile.open.cursor, 'pointer', JSON.stringify(addfile))
    assert.equal(addfile.open.center, true, JSON.stringify(addfile))
    assert.deepEqual(addfile.open.corners, [true, true, true, true], JSON.stringify(addfile))
    assert.equal(addfile.fold.w, 0, `收起的胶囊里不该有「＋ 文件」：${JSON.stringify(addfile)}`)
    assert.deepEqual(measured.addfileActs, [{ type: 'add' }])
    // 第 5 条：出卡那一帧 MutationObserver 回调里量，流末余量 ≤ 1
    const gap = measured.flow['484x718'].gap
    assert.equal(typeof gap, 'number', `gap=${gap}`)
    assert.ok(gap <= 1, `流末被切 ${gap}px`)
    // 第 6 条：拖着文件进窗，整窗一块（不再分范本 / 材料），压上去变实线，上面不写字
    assert.equal(measured.drag.zones, 1, JSON.stringify(measured.drag))
    assert.equal(measured.drag.hidden, false, JSON.stringify(measured.drag))
    assert.equal(measured.drag.lit, true, JSON.stringify(measured.drag))
    assert.equal(measured.drag.words, '', JSON.stringify(measured.drag))
    // 第 7 条：界面上那几样东西的位置和样子
    const done = measured.design.done
    assert.ok(done.userRight >= 0 && done.userRight <= 16, `我说的没靠右：${JSON.stringify(done)}`)
    // 它说的前面有个小岛头像（22×12），头像和正文之间留 10
    assert.ok(done.ava, `它说的前面没有小岛头像：${JSON.stringify(done)}`)
    assert.deepEqual([done.ava.w, done.ava.h], [22, 12], JSON.stringify(done))
    assert.equal(done.ava.before, 10, JSON.stringify(done))
    assert.equal(done.replyLeft - done.userRight, 32, JSON.stringify(done))
    // 做完了：没有过程行，也没有「正在工作」那行
    assert.equal(done.working, '', JSON.stringify(done))
    assert.equal(done.replies, 1, JSON.stringify(done))
    assert.equal(done.card.icon, true, JSON.stringify(done))
    assert.equal(done.card.buttons, 2, JSON.stringify(done))
    // 卡的标题写「文件生成」，文件名单独一行
    assert.equal(done.card.name, '文件生成', JSON.stringify(done))
    assert.equal(done.card.line, '本周周报.docx · 12 页', JSON.stringify(done))
    const fmt = measured.design.fmt
    assert.ok(fmt.md.h >= 1, `标题没照排：${JSON.stringify(fmt)}`)
    assert.equal(fmt.md.ul, 1, JSON.stringify(fmt))
    assert.equal(fmt.md.table, 1, JSON.stringify(fmt))
    assert.equal(fmt.md.stars, false, JSON.stringify(fmt))
    const ask = measured.design.ask
    assert.equal(ask.tail, '等你回答', JSON.stringify(ask))
    assert.equal(ask.tailColor, 'rgb(197, 58, 34)', JSON.stringify(ask))
    const fail = measured.design.fail
    assert.equal(fail.errColor, 'rgb(197, 58, 34)', JSON.stringify(fail))
    assert.equal(fail.err, '密钥未填写· Si101 错误', JSON.stringify(fail))
    // 提示级：灰字一行、带 ×（鼠标提示「关闭」），点 × 发 dismiss
    const notice = measured.design.notice
    assert.equal(notice.level, 'notice', JSON.stringify(notice))
    assert.equal(notice.text, '图片格式不支持· Si702 错误', JSON.stringify(notice))
    assert.equal(notice.color, 'rgb(95, 90, 82)', JSON.stringify(notice))
    assert.equal(notice.x, true, JSON.stringify(notice))
    assert.equal(notice.xTitle, '关闭', JSON.stringify(notice))
    assert.deepEqual(measured.design.noticeActs, [{ type: 'dismiss' }])
    // 干活中：对话流最下面一行浅字，只说在干什么，不带计时（这一幕是壳在读文件）
    const work = measured.design.work
    assert.equal(work.working, '读取文件中', JSON.stringify(work))
    // 装不装确认卡照稿量：内边距 12/14、圆角 8、三行标签宽 56（只摆拿主意要看的）、行间距 10、按钮尺寸 52×24 / 50×26
    const offer = measured.install.ask
    assert.ok(offer, '没量到确认卡')
    assert.deepEqual(offer.pad, { t: 12, r: 14, b: 12, l: 14 }, JSON.stringify(offer))
    assert.equal(offer.radius, '8px', JSON.stringify(offer))
    assert.equal(offer.rows, 3, JSON.stringify(offer))
    assert.equal(offer.title, '安装技能', JSON.stringify(offer))
    assert.deepEqual(offer.labels, ['名称', '来源', '用途'], JSON.stringify(offer))
    // 来源：仓库和版本两截，中间只空开，不写「·」
    assert.deepEqual(offer.from, ['github.com/某作者/mindmap-skill', 'main'], JSON.stringify(offer))
    assert.equal(offer.fromGap, 8, JSON.stringify(offer))
    assert.equal(offer.labelW, 56, JSON.stringify(offer))
    assert.equal(offer.rowGap, 10, JSON.stringify(offer))
    assert.ok(Math.abs(offer.yes.w - 52) <= 1 && Math.abs(offer.yes.h - 24) <= 1, JSON.stringify(offer.yes))
    assert.ok(Math.abs(offer.no.w - 50) <= 1 && Math.abs(offer.no.h - 26) <= 1, JSON.stringify(offer.no))
    assert.equal(offer.buttons, 2, JSON.stringify(offer))
    assert.equal(offer.red, 0, `不该有红字：${JSON.stringify(offer)}`)
    // 查不过的：没有「装上」，红字只一句「技能无效」（哪条没过进日志）
    const bad = measured.install.bad
    assert.equal(bad.yes, false, JSON.stringify(bad))
    assert.equal(bad.buttons, 1, JSON.stringify(bad))
    assert.equal(bad.bad, 1, JSON.stringify(bad))
    assert.deepEqual(bad.badText, ['技能无效'], JSON.stringify(bad))
    // 装的时候连不上：只有那一行红字，前一句说那一类，GitHub 回的状态接在后面
    const red = measured.install.red
    assert.equal(red.count, 1, JSON.stringify(red))
    assert.deepEqual(red.bad, ['连接失败 · Si906 错误，HTTP 503'], JSON.stringify(red))
    assert.equal(red.color, 'rgb(197, 58, 34)', JSON.stringify(red))
    // 干活中：两个按钮都灰
    const grey = measured.install.grey
    assert.equal(grey.count, 2, JSON.stringify(grey))
    assert.equal(grey.all, true, JSON.stringify(grey))
    assert.deepEqual(grey.labels, ['安装', '取消'], JSON.stringify(grey))
    // 装好了：卡没了，最后一句它说的气泡
    assert.equal(measured.install.installed.card, false, JSON.stringify(measured.install.installed))
    assert.equal(measured.install.installed.last, '技能已安装', JSON.stringify(measured.install.installed))
    // 渲染进程崩了：10 秒内页面自己回来，task:ready 又被调了一次，还是崩之前那个视图
    const crash = measured.crash
    assert.ok(crash, 'checks.json 里没有 crash')
    assert.equal(crash.back, true, '崩了以后页面没自己回来')
    assert.ok(crash.readyAfter > crash.readyBefore, `task:ready 没被再调：${JSON.stringify(crash)}`)
    assert.equal(crash.crashes.length, 1, JSON.stringify(crash))
    assert.equal(crash.crashes[0].reload, true, JSON.stringify(crash))
    assert.ok(crash.before.count > 0, JSON.stringify(crash.before))
    assert.equal(crash.after.count, crash.before.count, `回来以后视图不一样：${JSON.stringify(crash)}`)
    assert.equal(crash.after.first, crash.before.first, `回来以后第一条的字不一样：${JSON.stringify(crash)}`)

    // 新闻那一页：标题解成粗体（≥600）、星号不露；条间细线 2 条、上下各 12px；来源段 12px 小字、链接还在
    const news = measured.news
    assert.ok(Number(news.weight) >= 600, `标题没解成粗体：${JSON.stringify(news)}`)
    assert.equal(news.stars, false, `星号露出来了：${JSON.stringify(news)}`)
    assert.equal(news.hrs, 2, `条间细线该是 2 条：${JSON.stringify(news)}`)
    assert.deepEqual(news.hrMargin, ['12px', '12px'], `细线上下间距不是 12px：${JSON.stringify(news)}`)
    assert.equal(news.srcSize, '12px', `来源段不是小字：${JSON.stringify(news)}`)
    assert.equal(news.srcCount, 3, JSON.stringify(news))
    assert.equal(news.srcLinks, 2, `来源段里的链接不在了：${JSON.stringify(news)}`)

    // 干活中插一句：插进去的话冒成「我说的」气泡，下面一行 11px 灰字；输入框不锁、停下另有一个钮
    assert.equal(record.checks.steerBubble, '只写销售和库存两块就行', JSON.stringify(record.checks))
    assert.equal(record.checks.steerNote, '已发送，正在等待模型响应', JSON.stringify(record.checks))
    assert.equal(record.checks.steerSize, '11px', JSON.stringify(record.checks))
    assert.equal(record.checks.steerColor, 'rgb(95, 90, 82)', JSON.stringify(record.checks))
    assert.equal(record.checks.steerPlaceholder, '拖动文件到聊天框，或随便说点什么', JSON.stringify(record.checks))
    assert.equal(record.checks.steerLocked, false, JSON.stringify(record.checks))
    assert.equal(record.checks.steerStopHidden, false, JSON.stringify(record.checks))
    // 贴图片和长文字：剪贴板放一张 PNG、一段 3000 字，在输入框上贴——两个小签、图片小签 28×28 缩略图、
    // 贴的目录里有 贴的图-1.png 和 贴的文字-1.md、输入框里没有那 3000 字；长文字小签的菜单里多了「改回文字」
    const paste = measured.paste
    assert.equal(paste.count, 2, `该有两个小签：${JSON.stringify(paste)}`)
    assert.deepEqual(paste.names, ['贴的图-1.png', '贴的文字-1.md'], JSON.stringify(paste))
    assert.deepEqual(paste.subs, ['图片', '3,000 字'], JSON.stringify(paste))
    assert.deepEqual(paste.thumb, { w: 28, h: 28, src: true }, `图片小签该是 28×28 缩略图：${JSON.stringify(paste.thumb)}`)
    assert.deepEqual(paste.notes, [], `贴了长文字不另说一句：${JSON.stringify(paste)}`)
    assert.equal(paste.inputLength, 0, '那 3000 字不该塞进输入框')
    assert.equal(paste.files.image, true, '贴的图-1.png 没存下来')
    assert.equal(paste.files.text, true, '贴的文字-1.md 没存下来')
    assert.equal(paste.files.textChars, 3000, JSON.stringify(paste.files))
    assert.ok(paste.files.imageBytes > 0, JSON.stringify(paste.files))
    assert.ok(paste.menu.includes('还原为文字'), `长文字小签的菜单该有还原为文字：${JSON.stringify(paste.menu)}`)

    // 小签行：七份文件。收着的时候只摆前三个、多出来的收进「+N」；
    // 小签上没有「范本」那种记号（不再分范本和材料）；
    // 点开「+N」七个签都摆出来换行摆，最后一个是「收起」，再点收回
    const tags = measured.tags
    assert.ok(tags, 'checks.json 里没有 tags')
    assert.equal(tags.collapsed.tags, 3, `收着的时候该只摆三个：${JSON.stringify(tags.collapsed)}`)
    assert.equal(tags.collapsed.more, '+4', JSON.stringify(tags.collapsed))
    assert.ok(tags.collapsed.moreTitle.includes('材料-生产.docx') && tags.collapsed.moreTitle.includes('材料-渠道.pptx'), `「+N」的提示里没有藏起来的文件名：${JSON.stringify(tags.collapsed)}`)
    assert.ok(tags.collapsed.moreBox.w >= 32 && tags.collapsed.moreBox.h >= 24, `「+N」的点击区太小：${JSON.stringify(tags.collapsed.moreBox)}`)
    assert.equal(tags.collapsed.moreTag, 'BUTTON', `「+N」得是个能 Tab 到的按钮：${JSON.stringify(tags.collapsed.moreTag)}`)
    assert.equal(tags.collapsed.moreVisible, true, `「+N」被挤出小签行，点不到：${JSON.stringify(tags.collapsed)}`)
    assert.ok(tags.collapsed.moreTab >= 0, `「+N」Tab 不到：${JSON.stringify(tags.collapsed.moreTab)}`)
    assert.equal(tags.keyboard, true, '回车按不开「+N」')
    assert.equal(tags.collapsed.marks, 0, JSON.stringify(tags.collapsed))
    assert.equal(tags.collapsed.first, '上周周报.docx', JSON.stringify(tags.collapsed))
    // 小签行上沿那条：收着 46（上下各 10 + 小签 26），
    // 展开成两行 78（再加一行小签 26 和行距 6）
    assert.equal(tags.collapsed.tagH, 26, `小签该是 26 高：${JSON.stringify(tags.collapsed)}`)
    assert.equal(tags.strip.strip, 46, `收着时小签行上沿该是 46：${JSON.stringify(tags.strip)}`)
    assert.equal(tags.strip.rows, 1, `收着的时候该是一行：${JSON.stringify(tags.strip)}`)
    assert.equal(tags.stripExpanded.strip, 78, `展开两行时小签行上沿该是 78：${JSON.stringify(tags.stripExpanded)}`)
    assert.equal(tags.stripExpanded.rows, 2, `展开的时候该是两行：${JSON.stringify(tags.stripExpanded)}`)
    assert.equal(tags.expanded.count, 7, `展开后该有七个签：${JSON.stringify(tags.expanded)}`)
    assert.equal(tags.expanded.visible, true, `展开后有签看不见：${JSON.stringify(tags.expanded)}`)
    assert.equal(tags.expanded.lastText, '收起', JSON.stringify(tags.expanded))
    assert.ok(tags.expanded.lastClass.includes('collapse'), JSON.stringify(tags.expanded))
    // 展开的时候小签行变高，对话区就矮一块（对话区自动让位）
    assert.ok(tags.expanded.flowH < tags.collapsed.flowH, `展开时对话区没让位：${JSON.stringify(tags)}`)
    // 混排：高 38 的签（贴的图那种）跟高 26 的签摆一行，中线要重合
    assert.equal(tags.mixed.heights.length, 2, JSON.stringify(tags.mixed))
    assert.ok(tags.mixed.heights.includes(38), `没塞进高 38 的签：${JSON.stringify(tags.mixed)}`)
    assert.ok(Math.abs(tags.mixed.centers[0] - tags.mixed.centers[1]) <= 1, `混排没对齐：${JSON.stringify(tags.mixed)}`)
    // 展开的时候混排也对：26 和 38 高的签中线还是重合
    assert.ok(tags.mixedExpanded, 'checks.json 里没有 mixedExpanded')
    assert.ok(Math.abs(tags.mixedExpanded.centers[0] - tags.mixedExpanded.centers[1]) <= 1, `展开后混排没对齐：${JSON.stringify(tags.mixedExpanded)}`)

    // 第 8 条：回车发消息 → 滚到底；用户自己往上翻着看 → 来了新内容不硬拽
    const scroll = measured.scroll
    assert.ok(scroll.before.height > scroll.before.client, `对话流不够长，测不了滚动：${JSON.stringify(scroll)}`)
    assert.ok(scroll.after.top >= scroll.after.height - scroll.after.client - 2, `发完没滚到底：${JSON.stringify(scroll)}`)
    const keep = measured.scrollKeep
    // 场景得够长：翻到顶也离底超过 GAP，「不硬拽」那条路才轮得到走，不然这组断言测了个寂寞
    assert.ok(keep.before.height - keep.before.client > GAP, `长对话不够长，翻到顶也离底不足 GAP：${JSON.stringify(keep)}`)
    assert.equal(keep.before.top, 0, JSON.stringify(keep))
    assert.equal(keep.after.top, 0, `用户往上翻着的时候被硬拽到底了：${JSON.stringify(keep)}`)
    assert.equal(keep.label, '回到最新 ▾', JSON.stringify(keep))
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})
