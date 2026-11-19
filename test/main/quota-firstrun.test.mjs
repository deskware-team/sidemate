// 点小岛走哪条路：开任务窗，还是开首次运行窗（贴钥匙）。
// 这一层是纯逻辑（app/main/first-run.mjs），node --test 直接测。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaults, saveCatalog, setDefault } from '../../app/models/catalog.mjs'
import { createConsent } from '../../app/models/consent.mjs'
import { resolveModel } from '../../app/models/resolve.mjs'
import { needFirstRun } from '../../app/byok/first.mjs'
import { islandClick, modelConfigured } from '../../app/main/first-run.mjs'
import { startupPlan } from '../../app/main/startup.mjs'

// 假钥匙：不带 sk- 开头
function fakeKeyring(keys = {}) {
  const map = new Map(Object.entries(keys))
  return {
    read(id) { return map.has(id) ? map.get(id) : null },
    has(id) { return map.has(id) },
    env(ids) {
      const out = {}
      for (const id of Array.isArray(ids) ? ids : []) {
        if (!map.has(id)) continue
        out[id] = map.get(id)
      }
      return out
    },
  }
}

// 临时目录：清单、同意记录
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-quota-firstrun-'))
  return {
    dir,
    files: {
      catalog: join(dir, 'models.json'),
      consent: join(dir, 'consent.json'),
    },
  }
}

// 写成「默认走 Kilo 那条、说明已同意」的样子
function freeAndAgreed(files) {
  const picked = setDefault(defaults(), { entry: 'kilo', model: 'kilo-auto/free', effort: null })
  assert.equal(picked.ok, true)
  saveCatalog(files.catalog, picked.catalog)
  createConsent({ file: files.consent }).agree({ terms: true, crossBorder: true })
}

test('Kilo 那条线路：模型算得通，点小岛开任务窗', () => {
  const { dir, files } = scratch()
  try {
    freeAndAgreed(files)
    const result = resolveModel({ choice: null, files, keyring: fakeKeyring() })
    assert.equal(result.ok, true)
    assert.equal(modelConfigured(result), true)
    assert.equal(islandClick({ configured: modelConfigured(result) }), 'task')
    // 首次运行那扇窗也不该再开（开场放过、模型配过 → 不用首次运行）
    assert.equal(needFirstRun({ ready: modelConfigured(result), introPlayed: true }), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('从没配过任何模型：走首次运行', () => {
  const { dir, files } = scratch()
  try {
    // 清单里没有默认条目：模型算不通
    saveCatalog(files.catalog, { version: 1, default: { entry: '', model: '', effort: null }, entries: [] })
    const result = resolveModel({ choice: null, files, keyring: fakeKeyring() })
    assert.equal(result.ok, false)
    assert.equal(modelConfigured(result), false)
    assert.equal(islandClick({ configured: modelConfigured(result) }), 'first-run')
    assert.equal(needFirstRun({ ready: modelConfigured(result), introPlayed: true }), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('开机启动来的（--login）不影响走哪条路', () => {
  const login = startupPlan({ argv: ['sidemate.exe', '--login'] })
  const normal = startupPlan({ argv: ['sidemate.exe'] })
  assert.equal(login.login, true)
  assert.equal(normal.login, false)
  // 配过模型的：开机来的和手点的都开任务窗
  assert.equal(islandClick({ configured: true, login: login.login }), 'task')
  assert.equal(islandClick({ configured: true, login: normal.login }), 'task')
  // 没配过的：两条都走首次运行
  assert.equal(islandClick({ configured: false, login: login.login }), 'first-run')
  assert.equal(islandClick({ configured: false, login: normal.login }), 'first-run')
  // 开机启动那次自己不开任务窗：小岛在，点它才开
  assert.equal(login.openTask, false)
  assert.equal(normal.openTask, true)
})

test('配好了没配好：几种结果都分得清', () => {
  assert.equal(modelConfigured({ ok: true }), true)
  assert.equal(modelConfigured({ ok: false, reason: 'key' }), false)
  assert.equal(modelConfigured({ ok: false, reason: 'consent' }), false)
  assert.equal(modelConfigured({ ok: false, reason: 'missing' }), false)
  assert.equal(modelConfigured(null), false)
  assert.equal(modelConfigured(undefined), false)
})
