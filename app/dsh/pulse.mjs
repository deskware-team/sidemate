// 状态行上「模型在不在动」：请求发出去了在等回话 → 在想 → 在写回答；调工具时报 tool
//（壳那边照旧翻成「在读 xxx」这类）。静了 20 秒以上就把最后一次动静的时刻报出去，界面自己数秒。
// 只在换了说法、静下来、又动起来的时候报一声，最多一秒一次；想的、写的内容一个字都不往外报。

export const QUIET_MS = 20_000
const TICK_MS = 1_000
// 工具跑完了的两种状态
const DONE = new Set(['completed', 'failed'])

export function createPulse({ emit, now = Date.now, quietMs = QUIET_MS, tickMs = TICK_MS } = {}) {
  let phase = '' // wait 等回话 · think 在想 · write 在写回答 · tool 在调工具；空是还没发请求
  let lastAt = 0 // 最后一次动静
  let told = { phase: '', quietSince: 0 }
  let toldAt = -Infinity
  let timer = null
  let stopped = false
  const running = new Set() // 还没跑完的工具调用

  // 报一声：跟上回一样就不报；离上回不到一拍先压着，下一拍再报
  function tell() {
    if (stopped) return
    const quietSince = lastAt && now() - lastAt > quietMs ? lastAt : 0
    if (phase === told.phase && quietSince === told.quietSince) return
    if (now() - toldAt < tickMs) return
    told = { phase, quietSince }
    toldAt = now()
    emit({ type: 'pulse', phase, quietSince })
  }

  function touch(next) {
    lastAt = now()
    if (next) phase = next
    tell()
  }

  return {
    // 发出一次请求：在等模型回话
    prompt() {
      running.clear()
      touch('wait')
      if (timer || stopped) return
      timer = setInterval(tell, tickMs)
      timer.unref?.()
    },
    // ACP 的每一条 session/update 都算动了一下；这几种换说法
    update(update) {
      const kind = update?.sessionUpdate
      if (kind === 'agent_thought_chunk') return touch('think')
      if (kind === 'agent_message_chunk') return touch('write')
      if (kind === 'tool_call') {
        if (update.toolCallId && !DONE.has(update.status)) running.add(update.toolCallId)
        return touch('tool')
      }
      if (kind === 'tool_call_update' && DONE.has(update.status)) {
        running.delete(update.toolCallId)
        // 工具都跑完了：结果交回模型，又在等它回话
        return touch(running.size ? 'tool' : 'wait')
      }
      // 别的动静（用量、工具还在跑）：只算动了，说法不变；请求还没发就不算
      if (phase) touch('')
    },
    // 走一拍：压着没报的补报，静够了报一声（平时由定时器走，测试里手动走）
    tick: tell,
    stop() {
      stopped = true
      clearInterval(timer)
      timer = null
    },
  }
}
