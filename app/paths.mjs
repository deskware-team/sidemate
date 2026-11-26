// 程序数据放在哪儿，只在这里定一次。
// 根目录：%LOCALAPPDATA%\sidemate\（Windows 本机数据目录；别的平台退回 ~/.local/share/sidemate）。
// 根下面：model.json（模型清单）、ability.json（能力状态）、mcp.json（外部工具服务）、
// useragreement.json（同意记录）、news.json（新闻主题），目录有 skills\、tasks\、news\、
// data\（日志、用量、位置）、dsh\（dsh 的家）、temp\（临时）、electron\（Electron 的 profile）。
// 旧目录（~\桌伴、LocalLow\桌伴、%APPDATA%\sidemate）一概不读、不迁、不删。
//
// 纯 node 模块（不引 electron）：主进程和 node --test 都能用。
// 页面模块不许引它：页面那边要路径，走 IPC 问主进程。

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 本机数据目录：%LOCALAPPDATA%
export function localAppData(env = process.env) {
  const value = env?.LOCALAPPDATA
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return join(homedir(), 'AppData', 'Local')
}

// 程序数据根目录：%LOCALAPPDATA%\sidemate
export function appRoot(env = process.env) {
  return join(localAppData(env), 'sidemate')
}

// 根目录下的每一个位置。别的模块从这儿取，别自己拼。
export function appPaths(root = appRoot()) {
  const base = String(root ?? '')
  const data = join(base, 'data')
  return {
    root: base,
    // 文件
    model: join(base, 'model.json'),
    ability: join(base, 'ability.json'),
    mcp: join(base, 'mcp.json'),
    agreement: join(base, 'useragreement.json'),
    newsTopics: join(base, 'news.json'),
    settings: join(data, 'settings.json'),
    // 目录
    skills: join(base, 'skills'),
    tasks: join(base, 'tasks'),
    news: join(base, 'news'),
    data,
    dsh: join(base, 'dsh'),
    temp: join(base, 'temp'),
    electron: join(base, 'electron'),
  }
}

// 日志、用量、位置这些零碎都放 data\ 下，文件名各归各家
export function dataPaths(root = appRoot()) {
  const base = appPaths(root)
  const dir = base.data
  return {
    dir,
    taskLog: join(dir, 'task.log'),
    settingsLog: join(dir, 'settings.log'),
    petLog: join(dir, 'pet.log'),
    perfLog: join(dir, 'perf.log'),
    newsLog: join(dir, 'news.log'),
    usage: join(dir, 'usage.json'),
    recent: join(dir, 'recent.json'),
    // 贴进输入框的图和长文字：还没发出去之前存在这儿
    paste: join(dir, 'paste'),
    newsRead: join(dir, 'news-read.json'),
    newsRun: join(dir, 'news-run.json'),
  }
}

// data\ 目录：日志写不进去的时候多半是目录还没有，建一个
export function ensureDataDir(root = appRoot()) {
  const dir = dataPaths(root).dir
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // 建不出来也不能耽误事（写日志的地方自己会吞掉错误）
  }
  return dir
}

// 任务文件夹的名字：年月日时分 + 两位随机数（14 位数字，如 20261116193042）
export const TASK_NAME_RE = /^\d{14}$/

function two(value) {
  return String(value).padStart(2, '0')
}

// 12 位时间 + 2 位随机数
export function taskFolderName(now = new Date(), random = Math.random) {
  const date = now instanceof Date ? now : new Date(now)
  const head = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}${two(date.getHours())}${two(date.getMinutes())}`
  const tail = String(Math.floor(random() * 100)).padStart(2, '0')
  return `${head}${tail}`
}

// 任务文件夹里的三样：用户文件的副本、过程文件（对话记录也在里头）、成品在根目录
export function taskLayout(taskDir) {
  const base = String(taskDir ?? '')
  return {
    root: base,
    received: join(base, 'received'),
    process: join(base, '.sidemate'),
    conversation: join(base, '.sidemate', 'conversation.json'),
  }
}
