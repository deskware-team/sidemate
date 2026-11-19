// 读链接拦本机和局域网：地址判定那些规矩的单测（纯逻辑，不起 dsh）。
// 每类要拦的地址至少一个，外网的放行，各种怪写法也要认出来。

import assert from 'node:assert/strict'
import test from 'node:test'
import { hostFromUrl, isBlockedHost, isBlockedHostName, isBlockedIp, isIpLiteral } from '../../app/dsh/net-guard.mjs'

test('本机和内网的地址都拦下来', () => {
  const blocked = [
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '0.1.2.3',
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.168.255.255',
    '169.254.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255',
    '::1', '::', 'fc00::1', 'fd00::1', 'fd00:ec2::254', 'fe80::1', 'febf::1',
    '::ffff:127.0.0.1', '::ffff:192.168.1.1', '64:ff9b::127.0.0.1',
  ]
  for (const one of blocked) assert.equal(isBlockedIp(one), true, `${one} 该拦`)
})

test('外网的地址放行', () => {
  const allowed = [
    '1.1.1.1', '8.8.8.8', '93.184.216.34',
    '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1',
    '169.253.1.1', '192.167.0.1', '192.169.0.1', '11.0.0.1', '126.255.255.255',
    '2001:4860:4860::8888', '2606:4700:4700::1111',
  ]
  for (const one of allowed) assert.equal(isBlockedIp(one), false, `${one} 不该拦`)
})

test('localhost 和 *.localhost 按名字拦', () => {
  assert.equal(isBlockedHostName('localhost'), true)
  assert.equal(isBlockedHostName('LocalHost'), true)
  assert.equal(isBlockedHostName('foo.localhost'), true)
  assert.equal(isBlockedHostName('a.b.localhost'), true)
  assert.equal(isBlockedHostName('localhost.example.com'), false)
  assert.equal(isBlockedHostName('notlocalhost'), false)
})

test('网址里取主机名：IPv6 去掉方括号，末尾的点去掉', () => {
  assert.equal(hostFromUrl('http://127.0.0.1:8080/x?y=1'), '127.0.0.1')
  assert.equal(hostFromUrl('http://[::1]:8080/'), '::1')
  assert.equal(hostFromUrl('http://LOCALHOST/'), 'localhost')
  assert.equal(hostFromUrl('http://example.com./'), 'example.com')
  assert.equal(hostFromUrl('不是网址'), '')
  assert.equal(hostFromUrl(''), '')
})

test('十进制、十六进制、八进制写法的 IP 认得出是本机', () => {
  // 网址解析器自己把这些写法归一成 127.0.0.1
  for (const one of ['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/']) {
    const host = hostFromUrl(one)
    assert.equal(host, '127.0.0.1', `${one} 归一后是 127.0.0.1`)
    assert.equal(isBlockedHost(host), true, `${one} 该拦`)
  }
})

test('写出来的地址和域名分开：域名要查 DNS 才判', () => {
  assert.equal(isIpLiteral('127.0.0.1'), true)
  assert.equal(isIpLiteral('::1'), true)
  assert.equal(isIpLiteral('example.com'), false)
  assert.equal(isBlockedHost('example.com'), false)
  assert.equal(isBlockedHost('127.0.0.1'), true)
  assert.equal(isBlockedHost('localhost'), true)
})
