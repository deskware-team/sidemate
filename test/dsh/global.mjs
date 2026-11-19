// 测试里写全局配置：设置那边做的事（模型路线、能力补丁、搜索那一行都在这份文件里）。
// 任务不再写这份文件：两个任务同时跑的时候各写各的会互相覆盖。
// 桌伴里是设置那边（app/main/main.mjs）在起 dsh 之前写一次、设置文件变了再写；
// 测试里没有设置那边，就在这儿照它的样子写好再起活。

import { join } from 'node:path'
import { writeGlobalPatch } from '../../app/dsh/daemon.mjs'
import { searchPatchYaml } from '../../app/dsh/models.mjs'
import { runTask } from '../../app/dsh/index.mjs'

// 写全局配置（<dsh 家>/cordis.patch.yml）：整份换掉，内容一样就不写。
export function writeGlobal(lowRoot, texts) {
  if (!lowRoot) return ''
  return writeGlobalPatch(join(lowRoot, 'dsh'), Array.isArray(texts) ? texts : [])
}

// 起一轮活：先把全局配置写好，再起活（活自己不再写这份文件）。
export function runTaskWithGlobal(options = {}) {
  const texts = Array.isArray(options.patchTexts) ? options.patchTexts.slice() : []
  if (options.searchBaseUrl) texts.push(searchPatchYaml(options.searchBaseUrl, options.searchApiKeyEnv))
  writeGlobal(options.lowRoot, texts)
  return runTask(options)
}
