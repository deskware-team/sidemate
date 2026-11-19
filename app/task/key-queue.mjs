// 每把密钥的并发排队：同一把密钥同时在跑的任务到上限时，新来的排着，前一个做完自动开始。
// 上限配在密钥上（limitOf 每次现取，用户中途改了上限要生效）：0 = 不限。
// 上限变了要调 refresh() 放行排着的（设置保存后接线那边调），不调就一直排着。
// 纯逻辑：不引 node:，页面那边也能用。

// 排队被取消时的错：名字是 AbortError，调用方按名字认
function abortError() {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

// 上限是多少：取不到或不是正数都按不限算（0 = 不限）
function limitValue(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

// 建一个排队器：limitOf(keyId) 给这把密钥的并发上限
export function createKeyQueue({ limitOf = () => 0 } = {}) {
  const keys = new Map() // keyId -> { running: 在跑的数, waiters: 排着的 }

  // 某把密钥的排队状态（没有就开一份）
  function stateOf(keyId) {
    let one = keys.get(keyId)
    if (!one) {
      one = { running: 0, waiters: [] }
      keys.set(keyId, one)
    }
    return one
  }

  // 这把密钥现在能不能再起一个
  function hasRoom(one, keyId) {
    const limit = limitValue(typeof limitOf === 'function' ? limitOf(keyId) : 0)
    if (limit === 0) return true
    return one.running < limit
  }

  // 放行排着的：先来先得，放到上限为止
  function pump(keyId) {
    const one = keys.get(keyId)
    if (!one) return
    while (one.waiters.length > 0 && hasRoom(one, keyId)) {
      const waiter = one.waiters.shift()
      if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener('abort', waiter.abortHandler)
      one.running += 1
      waiter.resolve(makeRelease(keyId))
    }
  }

  // 放行所有钥匙上排着的（refresh 调它：用户改了上限时用）
  function pumpAll() {
    for (const keyId of [...keys.keys()]) pump(keyId)
  }

  // 一个任务做完时调：放掉一个位子，再看看排着的能不能上
  function makeRelease(keyId) {
    let released = false
    return function release() {
      if (released) return // 重复调无害
      released = true
      const one = keys.get(keyId)
      if (!one) return
      one.running = Math.max(0, one.running - 1)
      pump(keyId)
    }
  }

  // 拿一把密钥的位子：拿不到就排队；排上了 resolve 一个 release（做完时调它）
  function acquire(keyId, { onQueued, signal } = {}) {
    if (signal && signal.aborted) return Promise.reject(abortError())
    const one = stateOf(keyId)
    if (hasRoom(one, keyId)) {
      one.running += 1
      return Promise.resolve(makeRelease(keyId))
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, abortHandler: null }
      if (signal) {
        waiter.abortHandler = () => {
          const at = one.waiters.indexOf(waiter)
          if (at >= 0) one.waiters.splice(at, 1)
          reject(abortError())
        }
        signal.addEventListener('abort', waiter.abortHandler, { once: true })
      }
      one.waiters.push(waiter)
      if (typeof onQueued === 'function') onQueued() // 界面拿它显示「排队中」
    })
  }

  // 这把密钥排着的有几个
  function size(keyId) {
    return keys.get(keyId)?.waiters.length ?? 0
  }

  // 这把密钥现在在跑的有几个
  function running(keyId) {
    return keys.get(keyId)?.running ?? 0
  }

  // 收摊：排队都散掉
  function close() {
    for (const one of keys.values()) {
      for (const waiter of one.waiters) {
        if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener('abort', waiter.abortHandler)
        waiter.reject(abortError())
      }
      one.waiters = []
    }
    keys.clear()
  }

  // 设置里改了并发上限以后调它：调大了排着的立刻上（不调就一直排着）
  return { acquire, size, running, refresh: pumpAll, close }
}
