// 模型这一摊要用的系统加密和钥匙串：任务壳（和别的壳）都从这一处拿，不各自再抄 electron。
// systemCrypto 照抄 app/byok/shell.mjs 的同名函数：加解密都走系统的 safeStorage。
// 密文直接存在 model.json / mcp.json 里对应的那一条上（app/models/keys.mjs 管怎么存）。
import { safeStorage } from 'electron'
import { createKeyring } from './keys.mjs'
import { modelFiles } from './files.mjs'

export function systemCrypto() {
  return {
    available: () => {
      try { return safeStorage.isEncryptionAvailable() } catch { return false }
    },
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (buf) => safeStorage.decryptString(buf),
  }
}

// 钥匙串：清单和外部工具服务各自一份文件，密文存在里面
export function openKeyring() {
  const files = modelFiles()
  return createKeyring({ files: { catalog: files.catalog, mcp: files.mcp }, crypto: systemCrypto() })
}
