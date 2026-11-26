// 小岛右键菜单里「最近」那一段：最近打开的文件夹和对话。
// 存着的、还在的才列（删掉、挪走了的不列）。
// 主进程专用（要开文件夹），页面那边用不到。

import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { shell } from 'electron'
import { recentMenuTemplate, recentTasks } from '../task/recent-tasks.mjs'
import { appPaths, appRoot } from '../paths.mjs'

export function recentMenu({ recentList, log, taskOpened }) {
  const root = appRoot(), all = appPaths().tasks
  return recentMenuTemplate(
    recentList().filter((dir) => existsSync(dir)).map((dir) => ({ dir, name: basename(dir) })),
    recentTasks(root),
    existsSync(all) ? all : '',
    {
      openFolder: (dir) => { log('menu', { item: 'recent', dir }); taskOpened({ recent: dir }) },
      openTask: (out) => { log('menu', { item: 'recent-task', dir: out }); void shell.openPath(out) },
      openAll: (dir) => { log('menu', { item: 'all-tasks', dir }); void shell.openPath(dir) },
    },
  )
}
