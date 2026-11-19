// 设置文件（data\settings.json）现在只记一件事：小岛开场放过没有。钥匙在 test/models 那边测。
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


test('the intro flag starts unset and gets remembered', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-byok-vault-'))
  try {
    const vault = createVault({ root })
    assert.equal(vault.introPlayed(), false)
    vault.markIntro()
    assert.equal(vault.introPlayed(), true)
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8')), { introPlayed: true })
    // 再记一遍还是同一份
    vault.markIntro()
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8')), { introPlayed: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy settings with extra fields are read and rewritten lean', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-byok-vault-'))
  try {
    writeSettingsFile(join(root, 'data', 'settings.json'), '{"rate":8,"introPlayed":true}\n')
    const vault = createVault({ root })
    assert.equal(vault.introPlayed(), true)
    vault.markIntro()
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8')), { introPlayed: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a broken or missing settings file counts as not played', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-byok-vault-'))
  try {
    writeSettingsFile(join(root, 'data', 'settings.json'), 'not json')
    assert.equal(createVault({ root }).introPlayed(), false)
    assert.equal(createVault({ root: join(root, 'nothing') }).introPlayed(), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('字号和小岛大小两档：写一项不冲掉别的', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-byok-vault-'))
  try {
    const vault = createVault({ root })
    vault.markIntro()
    vault.setOpenAtLogin(false)
    vault.setFontScale(1.3)
    // 写字号不冲掉小岛大小（还没写过：不凭空造一项）
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8')), { introPlayed: true, openAtLogin: false, fontScale: 1.3 })
    vault.setIslandScale(1.25)
    // 写小岛大小不冲掉字号，也不冲掉开场和开机那两项
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8')), {
      introPlayed: true, openAtLogin: false, fontScale: 1.3, islandScale: 1.25,
    })
    vault.setFontScale(0.9)
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8')), {
      introPlayed: true, openAtLogin: false, fontScale: 0.9, islandScale: 1.25,
    })
    // 读回来还是存的那个数；档位认不认在 app/main/zoom.mjs 那边判
    assert.equal(vault.fontScale(), 0.9)
    assert.equal(vault.islandScale(), 1.25)
    // 没写过、坏了的都给 undefined，不当 false 也不当 1
    const other = createVault({ root: join(root, 'fresh') })
    assert.equal(other.fontScale(), undefined)
    assert.equal(other.islandScale(), undefined)
    writeFileSync(join(root, 'broken'), 'not json')
    assert.equal(createVault({ root: join(root, 'broken') }).fontScale(), undefined)
    // 手改坏的值（不在档位里的数）：原样存取，档位那边当标准
    writeSettingsFile(join(root, 'data', 'settings.json'), '{"fontScale":1.07}\n')
    const kept = createVault({ root })
    assert.equal(kept.fontScale(), 1.07)
    kept.setIslandScale(0.85)
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf8')), { fontScale: 1.07, islandScale: 0.85 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
