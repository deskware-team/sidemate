// 随包 Python 接到 dsh 的工作区依赖上：<桌伴>\runtime\dependencies\python 是一个指到随包 python 的联接。
// 联接坏了（被换成空目录、指到的地方没了）要自己重接，不然 load_workspace_dependencies 找不到 python.exe。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runtimeCarrier } from '../../app/dsh/proc.mjs'

const EXE = process.platform === 'win32' ? 'python.exe' : join('bin', 'python3')

function stage() {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-carrier-'))
  const py = join(dir, 'python')
  mkdirSync(join(py, 'bin'), { recursive: true })
  writeFileSync(join(py, 'runtime.json'), '{"python":"3.12"}\n')
  writeFileSync(join(py, EXE), 'exe')
  return { dir, py, dest: join(dir, 'runtime') }
}

test('第一次：接一个指到随包 python 的联接，找得到 python', () => {
  const s = stage()
  try {
    assert.equal(runtimeCarrier(s.py, s.dest), s.dest)
    assert.equal(existsSync(join(s.dest, 'dependencies', 'python', EXE)), true)
    assert.equal(existsSync(join(s.dest, 'runtime.json')), true)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('联接被换成了空目录：拆掉重接', () => {
  const s = stage()
  try {
    mkdirSync(join(s.dest, 'dependencies', 'python'), { recursive: true })
    assert.equal(runtimeCarrier(s.py, s.dest), s.dest)
    assert.equal(existsSync(join(s.dest, 'dependencies', 'python', EXE)), true, '重接以后找得到 python')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('联接指到的地方没了（换了安装位置）：拆掉指到现在这份', () => {
  const s = stage()
  try {
    const old = join(s.dir, 'old-python')
    mkdirSync(old, { recursive: true })
    runtimeCarrier(old, s.dest)
    rmSync(old, { recursive: true, force: true })
    writeFileSync(join(s.py, 'runtime.json'), '{"python":"3.12"}\n')
    assert.equal(runtimeCarrier(s.py, s.dest), s.dest)
    assert.equal(existsSync(join(s.dest, 'dependencies', 'python', EXE)), true)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})
