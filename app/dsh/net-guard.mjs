// 判断一个网址是不是「本机或局域网里的地址」：纯逻辑，不引 node:，单测直接测这个文件。
// 干活的程序（dsh）那边挂一个小插件（./local-net-plugin.mjs），读链接前先过这里：
// 落在本机、内网、云元数据这些范围里就拦下来，默认不让读。
//
// 拦的范围：
//   - 回环：127.0.0.0/8、::1
//   - 名字：localhost 和 *.localhost
//   - 0.0.0.0/8
//   - 私网：10/8、172.16/12、192.168/16
//   - 链路本地：169.254/16、fe80::/10（含云元数据 169.254.169.254）
//   - CGNAT：100.64/10
//   - IPv6 ULA：fc00::/7（含 fd00:ec2::254）
//   - IPv4 映射的 IPv6（::ffff:…）按里面的 IPv4 判；NAT64（64:ff9b::/96）同样按里面的 IPv4 判
//
// 十进制、十六进制、八进制写法的 IP（http://2130706433/、http://0x7f.1/）由网址解析器自己归一，
// 归一之后就是 127.0.0.1，所以这里只判归一后的地址。
// 解析不出来的地址一律当「不是本机地址」：这个函数只管认得出的地址；
// 查不到地址的情况由插件那边当「拦下来」处理（./local-net-plugin.mjs）。

// 私网、链路本地、CGNAT 这几段 IPv4
function blockedIpv4(bytes) {
  const [a, b] = bytes
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10
  if (a === 127) return true // 127/8
  if (a === 169 && b === 254) return true // 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  return false
}

// IPv6：回环、未指定、ULA、链路本地、映射成 IPv4 的那几种
function blockedIpv6(bytes) {
  const zero = (from, to) => bytes.slice(from, to).every((one) => one === 0)
  if (zero(0, 16)) return true // ::
  if (zero(0, 15) && bytes[15] === 1) return true // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true // fc00::/7（fd00:ec2::254 也在里面）
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true // fe80::/10
  // ::ffff:a.b.c.d 和 64:ff9b::a.b.c.d：按里面的 IPv4 判
  const mapped = (zero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff)
    || (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zero(4, 12))
  if (mapped) return blockedIpv4(bytes.slice(12, 16))
  return false
}

// 四个数写成一段 IPv4：不是这个写法就返回 null
function parseIpv4(text) {
  const parts = String(text).split('.')
  if (parts.length !== 4) return null
  const out = []
  for (const one of parts) {
    if (!/^\d{1,3}$/.test(one)) return null
    const num = Number(one)
    if (num > 255) return null
    out.push(num)
  }
  return out
}

// 一段 IPv6 写成十六个字节：不是这个写法就返回 null
function parseIpv6(text) {
  let source = String(text).toLowerCase()
  const zone = source.indexOf('%')
  if (zone >= 0) source = source.slice(0, zone)
  if (!source.includes(':')) return null
  const halves = source.split('::')
  if (halves.length > 2) return null
  const bytes = []
  const push = (part, into) => {
    if (part.includes('.')) {
      const four = parseIpv4(part)
      if (!four) return false
      into.push(...four)
      return true
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) return false
    const num = parseInt(part, 16)
    into.push((num >> 8) & 0xff, num & 0xff)
    return true
  }
  const head = []
  for (const part of halves[0] ? halves[0].split(':') : []) if (!push(part, head)) return null
  const tail = []
  if (halves.length === 2) {
    for (const part of halves[1] ? halves[1].split(':') : []) if (!push(part, tail)) return null
  }
  if (halves.length === 1) return head.length === 16 ? head : null
  const fill = 16 - head.length - tail.length
  if (fill < 0) return null
  return [...head, ...new Array(fill).fill(0), ...tail]
}

// 这个地址是不是落在要拦的范围里：IPv4、IPv6 都算，判断不了的一律 false
export function isBlockedIp(ip) {
  const text = String(ip ?? '').trim().toLowerCase()
  if (text === '') return false
  const four = parseIpv4(text)
  if (four) return blockedIpv4(four)
  const six = parseIpv6(text)
  if (six) return blockedIpv6(six)
  return false
}

// 这个主机名是不是本机的名字：localhost 和 *.localhost
export function isBlockedHostName(host) {
  const text = String(host ?? '').trim().toLowerCase()
  if (text === '') return false
  if (text === 'localhost') return true
  return text.endsWith('.localhost')
}

// 主机名本身写的就是一个地址（不是域名）
export function isIpLiteral(host) {
  const text = String(host ?? '').trim().toLowerCase()
  if (text === '') return false
  if (text.includes(':')) return true
  return parseIpv4(text) !== null
}

// 从网址里取出主机名：IPv6 去掉方括号，末尾那个点去掉；网址不对就返回空
export function hostFromUrl(url) {
  const text = typeof url === 'string' ? url.trim() : ''
  if (text === '') return ''
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return ''
  }
  let host = String(parsed.hostname ?? '').toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  while (host.endsWith('.')) host = host.slice(0, -1)
  return host
}

// 光看主机名就知道是本机的（不用查 DNS）：名字是 localhost，或者直接写出来的地址在范围里
export function isBlockedHost(host) {
  const text = String(host ?? '').trim().toLowerCase()
  if (text === '') return false
  if (isBlockedHostName(text)) return true
  if (isIpLiteral(text)) return isBlockedIp(text)
  return false
}
