// 设置文件（data\settings.json）现在记两件事：开场放过没有、开机时自动打开桌伴。
// 写一项不冲掉另一项，这一组就是查这个。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { createVault } from '../../app/byok/vault.mjs'

// 设置文件在 data\ 下面：写之前先把目录建出来
function writeSettingsFile(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}


function read(root) {
  return JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8'))
}

test('开机启动这一项：没记过就是默认开', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-vault-login-'))
  try {
    const vault = createVault({ root })
    assert.equal(vault.openAtLogin(), undefined, '没记过')
    vault.setOpenAtLogin(false)
    assert.equal(vault.openAtLogin(), false)
    assert.deepEqual(read(root), { openAtLogin: false })
    vault.setOpenAtLogin(true)
    assert.equal(vault.openAtLogin(), true)
    assert.deepEqual(read(root), { openAtLogin: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('写开机启动：不冲掉开场放过没有', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-vault-login-'))
  try {
    const vault = createVault({ root })
    vault.markIntro()
    vault.setOpenAtLogin(false)
    assert.deepEqual(read(root), { introPlayed: true, openAtLogin: false })
    assert.equal(vault.introPlayed(), true)
    assert.equal(vault.openAtLogin(), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('写开场：不冲掉开机启动这一项', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-vault-login-'))
  try {
    const vault = createVault({ root })
    vault.setOpenAtLogin(true)
    vault.markIntro()
    assert.deepEqual(read(root), { introPlayed: true, openAtLogin: true })
    assert.equal(vault.openAtLogin(), true)
    assert.equal(vault.introPlayed(), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('别的不认识的项不写进去', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-vault-login-'))
  try {
    writeSettingsFile(join(root, 'data', 'settings.json'), '{"rate":8,"openAtLogin":false}\n')
    const vault = createVault({ root })
    vault.markIntro()
    assert.deepEqual(read(root), { introPlayed: true, openAtLogin: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
