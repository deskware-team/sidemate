import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { t } from '../copy/copy.mjs'

// 条款全文随包发布，路径由本文件位置算出，不写死盘符
export const TERMS_VERSION = '1.0'
export const TERMS_FILE = fileURLToPath(new URL('../legal/kilo-terms.md', import.meta.url))

// 弹窗上的五条要点，逐字照抄，不改写
export const SUMMARY = [
  t('consent.point1'),
  t('consent.point2'),
  t('consent.point3'),
  t('consent.point4'),
  t('consent.point5'),
]

// 两个勾选框的文案
export const CHECKS = {
  terms: t('consent.checkTerms'),
  crossBorder: t('consent.checkCross'),
}

// 读出条款全文，文件不在或读不了就返回空串
export function readTerms() {
  try {
    return readFileSync(TERMS_FILE, 'utf8')
  } catch {
    return ''
  }
}

export function createConsent({ file, version = TERMS_VERSION, now = Date.now }) {
  // 读记录，文件不存在或坏了都当作没同意过
  function read() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  // 先写临时文件再改名，避免中途断电写坏记录
  function write(record) {
    const dir = dirname(file)
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  }

  // 记录里必须有两条勾选才算同意
  function consented(record) {
    return record.terms === true && record.crossBorder === true
  }

  return {
    file,
    version,
    status() {
      const record = read()
      // 勾了、没撤回、版本对得上，才算当前这一版的同意
      const live = consented(record) && record.withdrawnAt == null
      return {
        agreed: live && record.version === version,
        version: record.version ?? null,
        at: record.at ?? null,
        stale: live && record.version !== version,
      }
    },
    agree({ terms, crossBorder } = {}) {
      if (terms !== true || crossBorder !== true) {
        return { ok: false, message: t('consent.needBoth') }
      }
      write({ version, at: now(), terms: true, crossBorder: true })
      return { ok: true }
    },
    withdraw() {
      const previous = read()
      const record = { terms: false, crossBorder: false }
      if (previous.version != null) record.version = previous.version
      if (previous.at != null) record.at = previous.at
      record.withdrawnAt = now()
      write(record)
      return { ok: true }
    },
    exists() {
      return existsSync(file)
    },
  }
}
