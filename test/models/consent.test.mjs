import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { CHECKS, SUMMARY, TERMS_FILE, TERMS_VERSION, createConsent, readTerms } from '../../app/models/consent.mjs'

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-consent-'))
  return { dir, file: join(dir, 'nested', '同意记录.json') }
}

test('a fresh install has not agreed yet', () => {
  const { dir, file } = tempFile()
  try {
    const consent = createConsent({ file })
    const status = consent.status()
    assert.equal(status.agreed, false)
    assert.equal(status.version, null)
    assert.equal(status.at, null)
    assert.equal(status.stale, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('only one tick is refused and nothing is written', () => {
  const { dir, file } = tempFile()
  try {
    const consent = createConsent({ file })
    const result = consent.agree({ terms: true, crossBorder: false })
    assert.equal(result.ok, false)
    assert.equal(result.message, '必须勾选两项')
    assert.equal(existsSync(file), false)
    assert.equal(consent.status().agreed, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a string true does not count as a tick', () => {
  const { dir, file } = tempFile()
  try {
    const consent = createConsent({ file })
    assert.equal(consent.agree({ terms: 'true', crossBorder: 'true' }).ok, false)
    assert.equal(existsSync(file), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two ticks agree and record the version and time', () => {
  const { dir, file } = tempFile()
  try {
    const consent = createConsent({ file, now: () => 1700000000000 })
    const result = consent.agree({ terms: true, crossBorder: true })
    assert.equal(result.ok, true)
    const status = consent.status()
    assert.equal(status.agreed, true)
    assert.equal(status.version, TERMS_VERSION)
    assert.equal(status.at, 1700000000000)
    assert.equal(status.stale, false)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.version, TERMS_VERSION)
    assert.equal(saved.at, 1700000000000)
    assert.equal(saved.terms, true)
    assert.equal(saved.crossBorder, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a newer version makes the old agreement stale', () => {
  const { dir, file } = tempFile()
  try {
    createConsent({ file }).agree({ terms: true, crossBorder: true })
    const newer = createConsent({ file, version: '1.1' })
    const status = newer.status()
    assert.equal(status.agreed, false)
    assert.equal(status.stale, true)
    assert.equal(status.version, TERMS_VERSION)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('withdrawing stops the agreement and agreeing again restores it', () => {
  const { dir, file } = tempFile()
  try {
    let clock = 1700000000000
    const consent = createConsent({ file, now: () => clock })
    consent.agree({ terms: true, crossBorder: true })
    clock = 1700000001000
    consent.withdraw()
    const after = consent.status()
    assert.equal(after.agreed, false)
    assert.equal(after.stale, false)
    assert.equal(after.version, TERMS_VERSION)
    clock = 1700000002000
    consent.agree({ terms: true, crossBorder: true })
    const back = consent.status()
    assert.equal(back.agreed, true)
    assert.equal(back.at, 1700000002000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a broken file counts as no agreement', () => {
  const { dir, file } = tempFile()
  try {
    const consent = createConsent({ file })
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{ this is not json', 'utf8')
    const status = consent.status()
    assert.equal(status.agreed, false)
    assert.equal(status.stale, false)
    assert.equal(consent.agree({ terms: true, crossBorder: true }).ok, true)
    assert.equal(consent.status().agreed, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the terms file ships with the package', () => {
  assert.equal(existsSync(TERMS_FILE), true)
  const terms = readTerms()
  assert.ok(terms.length > 0)
  for (const heading of ['一、', '二、', '三、', '四、', '五、', '六、', '七、']) {
    assert.ok(terms.includes(heading), `条款缺 ${heading}`)
  }
  assert.ok(terms.includes('ai-gateway.kilo.ai'))
  assert.ok(terms.includes('境外'))
  assert.equal(terms.includes('美国'), false)
})

test('the summary has five points and the last one shifts responsibility', () => {
  assert.equal(SUMMARY.length, 5)
  assert.ok(SUMMARY[4].includes('不对 Kilo AI'))
  // 第一条说清 Kilo AI 是第三方，后面几条都直说 Kilo AI
  assert.ok(SUMMARY[0].includes('第三方（Kilo AI）'))
  for (const point of SUMMARY.slice(1)) assert.equal(point.includes('第三方'), false, point)
  // 境外的说法跟条款全文一致：服务器「可能」在境外
  assert.ok(SUMMARY[1].includes('可能位于境外'))
  assert.ok(readTerms().includes('可能位于中华人民共和国境外'))
  assert.equal(CHECKS.terms, '我已阅读并同意使用须知')
  assert.equal(CHECKS.crossBorder, '我同意将发送的内容传输至 Kilo AI 处理')
})
