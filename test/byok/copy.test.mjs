import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { measure } from '../../build/lines.mjs'
import { INTRO_HINT } from '../../app/byok/copy.mjs'
import { t } from '../../app/copy/copy.mjs'
import { INTRO_LINE } from '../../app/pet/intro.mjs'

const dir = fileURLToPath(new URL('../../app/byok/', import.meta.url))

test('the first screen is a short intro: one title and three lines, laid out by data-t', () => {
  assert.equal(t('firstRun.aboutTitle'), '关于桌伴')
  const lines = ['firstRun.about1', 'firstRun.about2', 'firstRun.about3'].map((key) => t(key))
  assert.equal(lines.length, 3)
  for (const line of lines) assert.ok(line.length > 0 && line.length <= 80, line)
  // 不说「原件不修改」：dsh 会不会碰别的文件桌伴保证不了
  assert.equal(lines.some((line) => /原件|不修改|副本/.test(line)), false)
  const html = readFileSync(join(dir, 'page.html'), 'utf8')
  const section = html.match(/<section id="about">([\s\S]*?)<\/section>/)?.[1] || ''
  assert.match(section, /data-t="firstRun\.aboutTitle"/)
  assert.deepEqual([...section.matchAll(/data-t="(firstRun\.about\d)"/g)].map((m) => m[1]), ['firstRun.about1', 'firstRun.about2', 'firstRun.about3'])
  // 旧的四对标题和说明连同画它们的代码都删干净了
  for (const name of ['page.html', 'page.js', 'page.css', 'copy.mjs', 'shell.mjs']) {
    assert.equal(/safety|safe-title|safe-text/.test(readFileSync(join(dir, name), 'utf8')), false, name)
  }
})

test('the custom-model screen says where to configure it', () => {
  const html = readFileSync(join(dir, 'page.html'), 'utf8')
  const section = html.match(/<section id="custom"[^>]*>([\s\S]*?)<\/section>/)?.[1] || ''
  assert.match(section, /data-t="firstRun\.customHint"/)
  assert.ok(t('firstRun.customHint').includes('设置'))
})

test('the third step says the same line the island shows', () => {
  // 小岛冒的那一行，设置页也说同一句；不提钱，不提字聚成球
  assert.equal(INTRO_HINT, INTRO_LINE)
  assert.equal(INTRO_HINT, '把文件拖给我试试')
  assert.equal(/钱|元|球/.test(INTRO_HINT), false)
})

test('the screens do not use the banned words', () => {
  const banned = /terminal|git|patch|mcp|token/i
  for (const name of ['page.html', 'page.css', 'page.js', 'copy.mjs', 'first.mjs', 'preload.cjs']) {
    const text = readFileSync(join(dir, name), 'utf8')
    assert.equal(banned.test(text), false, name)
  }
  for (const key of ['firstRun.aboutTitle', 'firstRun.about1', 'firstRun.about2', 'firstRun.about3', 'firstRun.customHint']) {
    assert.equal(banned.test(t(key)), false, key)
  }
})

test('byok files stay within the per-file limit', () => {
  const result = measure([dir])
  assert.deepEqual(result.errors, [])
})
