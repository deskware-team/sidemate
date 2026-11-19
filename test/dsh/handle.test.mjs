// 桌伴起来时收拾 dsh 临时目录：收拾完之前起的任务先交一个代理手柄。
// 代理手柄和真手柄的方法要一样（少一个就有一处调不通，比如权限申请回话）。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { runTask } from '../../app/dsh/index.mjs'
import { startSweep } from '../../app/dsh/temp-sweep.mjs'

const roots = []

const scratch = (prefix = 'sidemate-handle-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 手柄上能调的那些方法
const methodsOf = (handle) => Object.keys(handle).filter((key) => typeof handle[key] === 'function').sort()

function launchOptions(extra = {}) {
  return {
    taskId: 'handle-test',
    workspace: scratch('sidemate-handle-ws-'),
    lowRoot: scratch('sidemate-handle-low-'),
    apiKey: 'sidemate-handle-key',
    prompt: '说一声好了',
    node: process.execPath,
    ...extra,
  }
}

// 可以手动放行的「收拾」：收拾完之前起的 dsh 先等着
function slowSweep() {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const run = startSweep({}, () => gate)
  return { release: () => { release({ removed: [] }); return run }, run }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('代理手柄也有 answerPermission，方法跟真手柄一样', async () => {
  const sweep = slowSweep()
  try {
    // payload 指到空目录：dsh 起不来，这轮马上就收场；这里只看手柄的样子
    const proxy = runTask(launchOptions({ payloadRoot: scratch() }))
    const methods = methodsOf(proxy)
    assert.ok(methods.includes('answerPermission'), '代理手柄没有 answerPermission')
    // dsh 还没起来就点权限：不卡死，回一句没回上
    assert.deepEqual(await proxy.answerPermission('perm-1', 'once'), { ok: false })
    await sweep.release()
    await proxy.done
    // 收拾完了再起：真手柄，方法跟代理手柄一样
    const real = runTask(launchOptions({ payloadRoot: scratch() }))
    assert.deepEqual(methodsOf(real), methods)
    await real.done
  } finally {
    await sweep.release()
  }
})
