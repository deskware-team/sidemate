import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { measure } from '../../build/lines.mjs'
import {
  MATERIAL_EXTENSIONS, MAX_FILE_BYTES, MAX_TOTAL_BYTES, clearWorkspace, copyMaterials, listFiles,
  prepareTask,
  snapshotWorkspace,
} from '../../app/workspace/index.mjs'

const roots = []
const now = new Date(2026, 10, 4)

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function write(path, text) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  return path
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('a task gets its own folder under tasks, and the products stay in its root', () => {
  const root = scratch('sidemate-root-')
  const folder = join(root, '用户 的文件夹')
  const source = write(join(folder, '上周 周报.docx'), '范本')
  write(join(folder, '子目录', '不该拷.md'), '里面')
  const dropped = prepareTask({ paths: [folder], prompt: '汇成本周周报后面这些不要了', root, now })
  assert.equal(dropped.kind, 'folder')
  assert.equal(dropped.sourceDir, folder)
  assert.notEqual(dropped.workspace, folder)
  // 任务文件夹的名字：年月日时分 + 两位随机数（14 位数字），在 tasks\ 下面
  assert.equal(dirname(dropped.workspace), join(root, 'tasks'))
  assert.equal(/^\d{14}$/.test(basename(dropped.workspace)), true)
  // 用户给的文件副本在任务文件夹的 received\ 里
  assert.equal(readFileSync(dropped.copied[0].to, 'utf8'), '范本')
  assert.equal(dropped.copied[0].to.startsWith(join(dropped.workspace, 'received')), true)
  // 成品就写在任务文件夹根目录：桌伴不再往别处拷一份
  const product = write(join(dropped.workspace, '本周周报.docx'), '新的')
  assert.equal(readFileSync(product, 'utf8'), '新的')
  assert.equal(readFileSync(source, 'utf8'), '范本')
  assert.equal(existsSync(join(folder, '本周周报.docx')), false)

  const file = write(join(root, '桌面', '一份 材料.txt'), '只有这份')
  const files = prepareTask({ paths: [file], prompt: '看一眼', root, now })
  assert.equal(files.kind, 'files')
  assert.notEqual(files.workspace, join(root, '桌面'))
  assert.equal(files.copied[0].to.startsWith(join(files.workspace, 'received')), true)
  assert.equal(existsSync(join(root, '桌面', '整理好的.txt')), false)

  // 什么都没拖、只说了一句话：也是一个任务，在 tasks\ 下有自己的文件夹，两句话两个文件夹
  const chat = prepareTask({ paths: [], prompt: '随便说说', root, now })
  const again = prepareTask({ paths: [], prompt: '随便说说', root, now })
  assert.equal(chat.kind, 'files')
  assert.notEqual(chat.workspace, again.workspace)
  assert.equal(dirname(chat.workspace), join(root, 'tasks'))
  assert.equal(/^\d{14}$/.test(basename(chat.workspace)), true)
  assert.equal(/^\d{14}$/.test(basename(again.workspace)), true)
})

test('chinese names, spaces, and a long path all copy', () => {
  const root = scratch('sidemate-long-')
  let dir = join(root, '我的 材料')
  for (let i = 0; i < 6; i += 1) dir = join(dir, `第${i}层 很长的目录`)
  const name = `${'周'.repeat(40)} 报.docx`
  const source = write(join(dir, name), '长路径正文')
  const task = prepareTask({ paths: [source], prompt: '你好 世界', root, now })
  assert.equal(task.copied.length, 1)
  assert.equal(task.copied[0].to.endsWith(name), true)
  assert.equal(readFileSync(task.copied[0].to, 'utf8'), '长路径正文')
  // 原件只拷副本，不再算指纹盯着它
  assert.equal('sha256' in task.copied[0], false)
  assert.equal('originals' in task, false)
  assert.equal(task.workspace.startsWith(join(root, 'tasks')), true)
  assert.equal(/^\d{14}$/.test(basename(task.workspace)), true)
  // 用户给的副本在任务文件夹的 received\ 里
  assert.equal(task.copied[0].to.startsWith(join(task.workspace, 'received')), true)
})

test('copy keeps the first level, skips env, links, and the wrong type', (t) => {
  const root = scratch('sidemate-copy-')
  const folder = join(root, '材料')
  write(join(folder, '笔记.MD'), '正文')
  write(join(folder, '.env'), 'DSH_HOME=/tmp/nope')
  write(join(folder, '照片.png'), 'png')
  write(join(folder, '程序.exe'), 'exe')
  write(join(folder, '空.txt'), '')
  write(join(folder, '子目录', '里面.docx'), '不拷')
  const outside = write(join(root, '外面.docx'), '链接目标-不该出现')
  const linkPath = join(folder, '联接.docx')
  const linked = tryLink(t, outside, linkPath)
  const task = prepareTask({ paths: [folder], prompt: '汇成/本周:周报', root, now })
  const names = task.copied.map(item => item.to.split(/[/\\]/).pop()).sort()
  // 图片算材料（拖图片文件进来不再算类型不对），照旧拷进工作区
  assert.deepEqual(names, ['照片.png', '空.txt', '笔记.MD'])
  assert.equal(/^\d{14}$/.test(basename(task.workspace)), true)
  assert.equal(task.skipped.some(item => item.reason === 'env-file'), true)
  if (linked) assert.equal(task.skipped.some(item => item.reason === 'link'), true)
  assert.equal(task.skipped.some(item => item.reason === 'wrong-type' && item.path.endsWith('程序.exe')), true)
  assert.equal(task.skipped.some(item => item.reason === 'not-a-file'), false)
  assert.equal(readFileSync(outside, 'utf8'), '链接目标-不该出现')
  if (linked) {
    const again = prepareTask({ paths: [linkPath], prompt: '链接', root, now })
    assert.equal(again.copied.length, 0)
    assert.equal(again.skipped[0].reason, 'link')
  }
})

test('materials include images: png jpg jpeg webp are copied, not watched as the wrong type', () => {
  assert.deepEqual(MATERIAL_EXTENSIONS.slice(-4), ['.png', '.jpg', '.jpeg', '.webp'])
  const root = scratch('sidemate-img-')
  const folder = join(root, '材料')
  write(join(folder, '截图.png'), 'png')
  write(join(folder, '照片.JPG'), 'jpg')
  write(join(folder, '样张.webp'), 'webp')
  write(join(folder, '动画.gif'), 'gif')
  const task = prepareTask({ paths: [folder], prompt: '图', root, now })
  assert.deepEqual(task.copied.map(item => basename(item.to)).sort(), ['截图.png', '样张.webp', '照片.JPG'])
  assert.equal(task.skipped.some(item => item.reason === 'wrong-type' && item.path.endsWith('动画.gif')), true)
})

test('copyMaterials adds files to a working workspace under the same rules', () => {
  const root = scratch('sidemate-more-')
  const ws = join(root, 'tasks', '202611040000')
  write(join(ws, '甲.md'), '已经在工作区里')
  const image = write(join(root, '贴的图-1.png'), 'png')
  const big = write(join(root, '太大.zip'), 'x')
  const more = copyMaterials({ workspace: ws, paths: [image, big] })
  assert.deepEqual(more.copied.map(item => [basename(item.from), basename(item.to)]), [['贴的图-1.png', '贴的图-1.png']])
  assert.equal(more.skipped.some(item => item.reason === 'wrong-type' && item.path === big), true)
  // 副本拷进任务文件夹的 received\ 里
  assert.equal(readFileSync(join(ws, 'received', '贴的图-1.png'), 'utf8'), 'png')
  assert.equal(existsSync(join(ws, '太大.zip')), false)
  // 同名不覆盖：带序号另存
  write(join(root, '贴的图-1.png'), '第二张同名的图')
  const again = copyMaterials({ workspace: ws, paths: [join(root, '贴的图-1.png')] })
  assert.equal(basename(again.copied[0].to), '贴的图-1-2.png')
})

test('a file or a batch over the cap is left out', () => {
  const root = scratch('sidemate-cap-')
  const folder = join(root, '材料')
  const small = write(join(folder, 'a.txt'), '12345678')
  const also = write(join(folder, 'b.txt'), 'abcdefgh')
  const huge = write(join(folder, 'c.txt'), '123456789')
  const task = prepareTask({
    paths: [folder],
    prompt: '上限',
    root,
    now,
    maxFileBytes: 8,
    maxTotalBytes: 12,
  })
  assert.equal(task.copied.length, 1)
  assert.equal(task.copied[0].from, small)
  assert.equal(task.skipped.filter(item => item.reason === 'too-big').map(item => item.path).sort().join(), [also, huge].sort().join())
  assert.equal(MAX_FILE_BYTES, 32 * 1024 * 1024)
  assert.equal(MAX_TOTAL_BYTES, 128 * 1024 * 1024)
})

test('two sources with the same name get a number', () => {
  const root = scratch('sidemate-name-')
  const first = write(join(root, '甲', '周报.docx'), '甲')
  const second = write(join(root, '乙', '周报.docx'), '乙')
  const task = prepareTask({ paths: [first, second], prompt: '两份', root, now })
  const names = task.copied.map(item => item.to.split(/[/\\]/).pop()).sort()
  assert.deepEqual(names, ['周报-2.docx', '周报.docx'])
})

test('the files the model wrote are what the user gets: nothing is copied anywhere else', () => {
  const root = scratch('sidemate-hash-')
  const folder = join(root, '材料')
  const source = write(join(folder, '原件.txt'), '原文')
  write(join(folder, '另一份.txt'), '也是')
  const task = prepareTask({ paths: [folder], prompt: '核', root, now })
  const product = write(join(task.workspace, '结果.txt'), '新')
  writeFileSync(source, '改了')
  assert.equal(readFileSync(product, 'utf8'), '新')
  assert.equal(readFileSync(source, 'utf8'), '改了', '原件不归桌伴管')
})

test('editing a copy is not a new output, and a link is not exported', (t) => {
  const root = scratch('sidemate-edit-')
  const source = write(join(root, '材料.txt'), '原文')
  const task = prepareTask({ paths: [source], prompt: '改副本', root, now })
  writeFileSync(task.copied[0].to, '副本改了')
  const outside = write(join(root, '别放.docx'), '别动')
  const linked = tryLink(t, outside, join(task.workspace, '指向.docx'))
  write(join(task.workspace, '真产出.docx'), '新文件')
  assert.equal(readFileSync(source, 'utf8'), '原文')
  if (linked) assert.equal(readFileSync(outside, 'utf8'), '别动')
})

test('cleanup keeps the products, clears the copies, and keeps the conversation', (t) => {
  const root = scratch('sidemate-clear-')
  const source = write(join(root, '用户', '原件.txt'), '留着')
  const task = prepareTask({ paths: [source], prompt: '清', root, now })
  write(join(task.workspace, '一层', '二层.txt'), '删')
  const outside = write(join(root, '链接目标.txt'), '不能删')
  const linked = tryLink(t, outside, join(task.workspace, '链出去.txt'))
  // 成品在根目录：留着
  write(join(task.workspace, '留下.txt'), '产出')
  // 过程目录里的对话记录：留着
  write(join(task.workspace, '.sidemate', 'conversation.json'), '{}')
  write(join(task.workspace, '.sidemate', '临时.txt'), 'x')
  clearWorkspace(task.workspace, root)
  assert.equal(existsSync(join(task.workspace, '一层')), false)
  if (linked) assert.equal(existsSync(join(task.workspace, '链出去.txt')), false)
  assert.equal(readFileSync(outside, 'utf8'), '不能删')
  assert.equal(readFileSync(join(task.workspace, '留下.txt'), 'utf8'), '产出')
  // 用户给的副本清掉
  assert.equal(existsSync(join(task.workspace, 'received')), false)
  // 对话记录留着，别的过程文件清掉
  assert.equal(readFileSync(join(task.workspace, '.sidemate', 'conversation.json'), 'utf8'), '{}')
  assert.equal(existsSync(join(task.workspace, '.sidemate', '临时.txt')), false)
  assert.equal(readFileSync(source, 'utf8'), '留着')
  clearWorkspace(task.workspace, root)
  assert.equal(existsSync(task.workspace), true)

  // 只说了一句话的任务：根目录里的文件是成品，留着；文件夹也留着（历史里那条还指着它，从历史打开还能接着聊）
  const empty = prepareTask({ paths: [], prompt: '聊两句', root, now })
  write(join(empty.workspace, '临时.txt'), 'x')
  clearWorkspace(empty.workspace, root)
  assert.equal(existsSync(empty.workspace), true)
  assert.deepEqual(readdirSync(empty.workspace), ['临时.txt'])
  clearWorkspace(join(root, 'tasks', '还没有'), root)

  const user = scratch('sidemate-user-')
  write(join(user, '我的.txt'), '我的')
  assert.throws(() => clearWorkspace(user, root), /can only clear desk workspaces/)
  assert.throws(() => clearWorkspace(join(root, '别处', '没有'), root), /can only clear desk workspaces/)
  assert.equal(readFileSync(join(user, '我的.txt'), 'utf8'), '我的')
})

test('an empty task folder stays, and a second task gets a number', () => {
  const root = scratch('sidemate-seq-')
  const source = write(join(root, 'a.txt'), 'a')
  const first = prepareTask({ paths: [source], prompt: '同一个', root, now })
  const second = prepareTask({ paths: [source], prompt: '同一个', root, now })
  // 同一个任务不会跟别的一个撞文件夹：名字后两位是摇出来的
  assert.notEqual(second.workspace, first.workspace)
  assert.equal(/^\d{14}$/.test(basename(first.workspace)), true)
  assert.equal(/^\d{14}$/.test(basename(second.workspace)), true)
  clearWorkspace(first.workspace, root)
  assert.equal(existsSync(first.workspace), true)
  const blank = prepareTask({ paths: [source], prompt: '   ???   ', root, now })
  assert.equal(/^\d{14}$/.test(basename(blank.workspace)), true)
})

// 同一天说两次「总结一下这个文件」：前一个只在对话里回答、收拾过了，后一个不能拿到同一个文件夹
test('same-day tasks with the same opening never share a folder, even after the first is cleared', () => {
  const root = scratch('sidemate-same-day-')
  const one = write(join(root, '甲.md'), '甲')
  const two = write(join(root, '乙.md'), '乙')
  const first = prepareTask({ paths: [one], prompt: '总结一下这个文件', root, now: new Date(2026, 10, 15, 9, 0, 5) })
  clearWorkspace(first.workspace, root)
  const second = prepareTask({ paths: [two], prompt: '总结一下这个文件', root, now: new Date(2026, 10, 15, 9, 0, 5) })
  assert.notEqual(second.workspace, first.workspace)
  // 前一个的文件夹哪怕被人删了，晚一点开的同名任务也拿不到它的名字：名字里带着时分秒
  // （已经清空了，用 rmdirSync 删：Node 24 在 Windows 上拿 rmSync 直接删某些中文名的文件夹会把进程崩掉）
  rmdirSync(first.workspace)
  const third = prepareTask({ paths: [two], prompt: '总结一下这个文件', root, now: new Date(2026, 10, 15, 14, 30, 0) })
  assert.notEqual(third.workspace, first.workspace)
  assert.equal(/^\d{14}$/.test(basename(first.workspace)), true)
  assert.equal(basename(first.workspace).startsWith('202611150900'), true)
  assert.equal(/^\d{14}$/.test(basename(third.workspace)), true)
  assert.equal(basename(third.workspace).startsWith('202611151430'), true)
})

test('a directory junction is not a workspace and is not copied', { skip: process.platform !== 'win32' }, () => {
  const root = scratch('sidemate-junction-')
  const real = join(root, '真文件夹')
  write(join(real, '原件.txt'), '原件')
  const link = join(root, '联接')
  symlinkSync(real, link, 'junction')
  const task = prepareTask({ paths: [link], prompt: '联接', root, now })
  assert.equal(task.kind, 'files')
  assert.equal(task.copied.length, 0)
  assert.equal(task.skipped[0].reason, 'link')
  assert.equal(readFileSync(join(real, '原件.txt'), 'utf8'), '原件')
})

// 扫出来的是模型动过的文件：received\（用户给的副本）、.sidemate\（过程文件）、锁文件都不算
test('the file scan leaves out the copies, the process files, and the lock files', () => {
  const root = scratch('sidemate-scan-')
  const source = write(join(root, '材料.txt'), '原文')
  const task = prepareTask({ paths: [source], prompt: '扫', root, now })
  write(join(task.workspace, '本周周报.docx'), '真的产出')
  write(join(task.workspace, '~$本周周报.docx'), 'word 开着')
  write(join(task.workspace, '.~本周周报.docx'), 'wps 开着')
  write(join(task.workspace, '.sidemate', '过程.txt'), '过程')
  const names = listFiles(task.workspace).map((one) => basename(one)).sort()
  assert.deepEqual(names, ['本周周报.docx'])
  // 快照也一样：根目录下的成品看得见，received\ 和过程目录看不见
  const seen = snapshotWorkspace(task.workspace)
  assert.equal(seen.some((rel) => rel.includes('received')), false)
  assert.equal(seen.some((rel) => rel.includes('.sidemate')), false)
  assert.equal(seen.some((rel) => rel.includes('~$')), false)
})

test('word and wps temp files are not copied', () => {
  const root = scratch('sidemate-temp-')
  const folder = join(root, '材料夹')
  write(join(folder, '~$临时.docx'), 'word-temp')
  write(join(folder, '.~临时.docx'), 'wps-temp')
  write(join(folder, '要点.md'), '正文')
  const task = prepareTask({ paths: [folder], prompt: '整理材料', root, now })
  assert.deepEqual(task.copied.map(item => item.to.split(/[/\\]/).pop()), ['要点.md'])
  assert.equal(task.skipped.filter(item => item.reason === 'temp-file').length, 2)
})

test('workspace does not remove a tree in one call and each file stays within the per-file limit', () => {
  const source = readFileSync(new URL('../../app/workspace/index.mjs', import.meta.url), 'utf8')
  assert.equal(/\brmSync\b/.test(source), false)
  const result = measure(['app/workspace'])
  assert.deepEqual(result.errors, [])
})

test('an original that cannot be read (locked or no permission) is skipped as unreadable, the rest are copied', () => {
  const root = scratch('sidemate-locked-')
  const folder = join(root, '材料')
  const locked = write(join(folder, '锁着.docx'), '打不开')
  write(join(folder, '能读.md'), '正文')
  const deny = process.platform === 'win32'
    ? spawnSync('icacls', [locked, '/deny', '*S-1-1-0:(RD)'], { windowsHide: true }).status === 0
    : (chmodSync(locked, 0), true)
  assert.ok(deny, '读权限没去掉')
  try {
    const task = prepareTask({ paths: [folder], prompt: '读不了的跳过', root, now })
    assert.deepEqual(task.copied.map(item => basename(item.to)), ['能读.md'])
    assert.deepEqual(task.skipped.filter(item => item.path === locked).map(item => item.reason), ['unreadable'])
    assert.equal(existsSync(join(task.workspace, 'received', '锁着.docx')), false)
  } finally {
    if (process.platform === 'win32') spawnSync('icacls', [locked, '/remove:d', '*S-1-1-0'], { windowsHide: true })
    else chmodSync(locked, 0o644)
  }
})

function tryLink(t, target, path, type) {
  try {
    if (type) symlinkSync(target, path, type)
    else symlinkSync(target, path)
    return true
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
    t.diagnostic('建不了软链（普通用户没有这个权限），跟链接有关的断言跳过')
    return false
  }
}
