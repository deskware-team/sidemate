// 测试用的最小 Office 文件：手搓一个不压缩的 zip 包，里面放 [Content_Types].xml 和对应的主体。
// 真装一份 Office 太重，这样够体检用（结构对、能打开），也能当普通文件读。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

// 手搓一个 zip（不压缩）：entries 是 { 包里的文件名: 文字 }
export function zipOf(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(String(text), 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    locals.push(local, data)
    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(centrals.length, 8)
  eocd.writeUInt16LE(centrals.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'

const BODY = {
  '.docx': 'word/document.xml',
  '.xlsx': 'xl/workbook.xml',
  '.pptx': 'ppt/presentation.xml',
}

// 一份结构对的 Office 文件（按后缀）
export function officeBytes(ext, text = '正文') {
  const body = BODY[ext]
  if (!body) return Buffer.from(String(text), 'utf8')
  return zipOf({ '[Content_Types].xml': CONTENT_TYPES, [body]: `<?xml version="1.0" encoding="UTF-8"?><root>${text}</root>` })
}

// 一份 pdf：%PDF 开头
export function pdfBytes(text = '正文') {
  return Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`, 'utf8')
}

// 按后缀写一份文件：docx/xlsx/pptx 是真的 zip 包，pdf 是 %PDF 开头
export function writeOffice(file, ext, text = '正文') {
  mkdirSync(dirname(file), { recursive: true })
  const data = ext === '.pdf' ? pdfBytes(text) : officeBytes(ext, text)
  writeFileSync(file, data)
  return file
}
