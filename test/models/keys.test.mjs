import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createKeyring, envName, maskKey } from '../../app/models/keys.mjs'

const DEEPSEEK = 'demo-key-deepseek-value'
const ZHIPU = 'demo-key-zhipu-value'

// 假加密：异或一下，够测试用
function xor() {
  return {
    available: () => true,
    encrypt(text) {
      const buf = Buffer.from(text, 'utf8')
      for (let i = 0; i < buf.length; i++) buf[i] ^= 0x5a
      return buf
    },
    decrypt(buf) {
      const copy = Buffer.from(buf)
      for (let i = 0; i < copy.length; i++) copy[i] ^= 0x5a
      return copy.toString('utf8')
    },
  }
}

// 目录里有没有明文
function found(dir, text) {
  const needles = [Buffer.from(text, 'utf8'), Buffer.from(text, 'utf16le')]
  const walk = (current) => {
    let names
    try { names = readdirSync(current) } catch { return false }
    for (const name of names) {
      const path = join(current, name)
      const st = statSync(path)
      if (st.isDirectory()) {
        if (walk(path)) return true
      } else if (needles.some((needle) => readFileSync(path).includes(needle))) return true
    }
    return false
  }
  return walk(dir)
}

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'sidemate-models-'))
}

// 密钥存在清单里对应的那一条上：先写一份 model.json，条目给这几个 id
function writeCatalog(root, ids) {
  const entries = ids.map((id) => ({
    id,
    name: id,
    kind: 'custom',
    protocol: 'openai',
    baseUrl: 'https://api.example.com',
    models: [{ id: `${id}-model`, name: 'M' }],
  }))
  const raw = {
    version: 1,
    default: { entry: ids[0], model: `${ids[0]}-model`, effort: null },
    entries,
  }
  writeFileSync(join(root, 'model.json'), `${JSON.stringify(raw, null, 2)}\n`)
}

test('一把钥匙存进去读得回来，删掉就没了', () => {
  const root = tmpRoot()
  try {
    writeCatalog(root, ['deepseek'])
    const keyring = createKeyring({ root, crypto: xor() })
    assert.deepEqual(keyring.list(), [])
    assert.equal(keyring.has('deepseek'), false)
    assert.equal(keyring.read('deepseek'), null)
    assert.equal(keyring.save('deepseek', `  ${DEEPSEEK}  `).ok, true)
    assert.equal(keyring.read('deepseek'), DEEPSEEK)
    assert.equal(keyring.has('deepseek'), true)
    // 密文直接存在 model.json 里对应的那一条上：没有「钥匙\」目录
    assert.equal(existsSync(join(root, 'model.json')), true)
    assert.equal(existsSync(join(root, '钥匙')), false)
    const raw = JSON.parse(readFileSync(join(root, 'model.json'), 'utf8'))
    const entry = raw.entries.find((one) => one.id === 'deepseek')
    assert.equal(typeof entry.sealed, 'string')
    assert.notEqual(entry.sealed, '')
    assert.equal(found(root, DEEPSEEK), false)
    assert.equal(keyring.remove('deepseek'), true)
    assert.equal(keyring.has('deepseek'), false)
    assert.equal(keyring.read('deepseek'), null)
    assert.equal(keyring.remove('deepseek'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('两家的钥匙互不影响', () => {
  const root = tmpRoot()
  try {
    writeCatalog(root, ['deepseek', 'c-zhipu-2'])
    const keyring = createKeyring({ root, crypto: xor() })
    assert.equal(keyring.save('deepseek', DEEPSEEK).ok, true)
    assert.equal(keyring.save('c-zhipu-2', ZHIPU).ok, true)
    assert.equal(keyring.read('deepseek'), DEEPSEEK)
    assert.equal(keyring.read('c-zhipu-2'), ZHIPU)
    assert.deepEqual(keyring.list(), ['c-zhipu-2', 'deepseek'])
    assert.equal(keyring.remove('c-zhipu-2'), true)
    assert.equal(keyring.read('c-zhipu-2'), null)
    assert.equal(keyring.read('deepseek'), DEEPSEEK)
    assert.deepEqual(keyring.list(), ['deepseek'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('空钥匙被拒', () => {
  const root = tmpRoot()
  try {
    const keyring = createKeyring({ root, crypto: xor() })
    assert.equal(keyring.save('deepseek', '').message, '密钥未填写')
    assert.equal(keyring.save('deepseek', '   ').message, '密钥未填写')
    assert.equal(keyring.save('deepseek', null).message, '密钥未填写')
    assert.equal(keyring.has('deepseek'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('加密用不了就拒，不落盘', () => {
  const root = tmpRoot()
  try {
    let touched = false
    const keyring = createKeyring({
      root,
      crypto: {
        available: () => false,
        encrypt() { touched = true; return Buffer.from(DEEPSEEK) },
        decrypt() { return DEEPSEEK },
      },
    })
    assert.equal(keyring.save('deepseek', DEEPSEEK).message, '密钥保存失败')
    assert.equal(touched, false)
    assert.equal(existsSync(join(root, '钥匙')), false)
    assert.equal(existsSync(join(root, 'model.json')), false)
    assert.equal(keyring.read('deepseek'), null)
    assert.equal(keyring.has('deepseek'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('密文里带明文就拒', () => {
  const root = tmpRoot()
  try {
    writeCatalog(root, ['deepseek'])
    const keyring = createKeyring({
      root,
      crypto: {
        available: () => true,
        encrypt: (text) => Buffer.from(text, 'utf8'),
        decrypt: (buf) => buf.toString('utf8'),
      },
    })
    assert.equal(keyring.save('deepseek', DEEPSEEK).message, '密钥保存失败')
    assert.equal(keyring.has('deepseek'), false)
    assert.equal(found(root, DEEPSEEK), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('解不开的钥匙当作没有', () => {
  const root = tmpRoot()
  try {
    writeCatalog(root, ['deepseek'])
    const keyring = createKeyring({
      root,
      crypto: {
        available: () => true,
        encrypt(text) {
          const buf = Buffer.from(text, 'utf8')
          for (let i = 0; i < buf.length; i++) buf[i] ^= 0x5a
          return buf
        },
        decrypt() { throw new Error('系统加密打不开') },
      },
    })
    assert.equal(keyring.save('deepseek', DEEPSEEK).ok, true)
    assert.equal(keyring.read('deepseek'), null)
    assert.equal(found(root, DEEPSEEK), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('不合法的 id 一律抛 TypeError', () => {
  const root = tmpRoot()
  try {
    const keyring = createKeyring({ root, crypto: xor() })
    for (const bad of ['../x', 'A', '', 'a/b', '-lead', 'a'.repeat(41)]) {
      assert.throws(() => keyring.save(bad, DEEPSEEK), TypeError)
      assert.throws(() => keyring.read(bad), TypeError)
      assert.throws(() => keyring.has(bad), TypeError)
      assert.throws(() => keyring.remove(bad), TypeError)
    }
    assert.equal(found(root, DEEPSEEK), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('0.2 的老 key.bin 不再当 DeepSeek 的钥匙：老用户要重新贴一次', () => {
  const root = tmpRoot()
  try {
    const crypto = xor()
    writeFileSync(join(root, 'key.bin'), crypto.encrypt(DEEPSEEK))
    const keyring = createKeyring({ root, crypto })
    assert.equal(keyring.read('deepseek'), null)
    assert.equal(keyring.has('deepseek'), false)
    assert.deepEqual(keyring.list(), [])
    // 老文件不动：桌伴不删用户自己的东西
    assert.equal(existsSync(join(root, 'key.bin')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('list 按 id 排序', () => {
  const root = tmpRoot()
  try {
    writeCatalog(root, ['c-zhipu-2', 'a-model'])
    const crypto = xor()
    const keyring = createKeyring({ root, crypto })
    assert.equal(keyring.save('c-zhipu-2', ZHIPU).ok, true)
    assert.equal(keyring.save('a-model', DEEPSEEK).ok, true)
    assert.deepEqual(keyring.list(), ['a-model', 'c-zhipu-2'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('env 只带上有钥匙的', () => {
  const root = tmpRoot()
  try {
    writeCatalog(root, ['c-zhipu-2'])
    const keyring = createKeyring({ root, crypto: xor() })
    assert.equal(keyring.save('c-zhipu-2', ZHIPU).ok, true)
    const env = keyring.env(['deepseek', 'c-zhipu-2'])
    assert.deepEqual(Object.keys(env), ['SIDEMATE_KEY_C_ZHIPU_2'])
    assert.equal(env.SIDEMATE_KEY_C_ZHIPU_2, ZHIPU)
    assert.equal(env.SIDEMATE_KEY_DEEPSEEK, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('envName 转换', () => {
  assert.equal(envName('deepseek'), 'SIDEMATE_KEY_DEEPSEEK')
  assert.equal(envName('c-zhipu-2'), 'SIDEMATE_KEY_C_ZHIPU_2')
  assert.equal(envName('a1'), 'SIDEMATE_KEY_A1')
  assert.throws(() => envName('../x'), TypeError)
})

test('密钥在界面上只露头尾四个', () => {
  assert.equal(maskKey('sk-1234567890abcdef'), 'sk-1234***cdef')
  assert.equal(maskKey('abcdefghijkl'), 'abcd***ijkl')
  assert.equal(maskKey('sk-abcd'), '***')
  assert.equal(maskKey(''), '***')
  assert.equal(maskKey(null), '***')
})
