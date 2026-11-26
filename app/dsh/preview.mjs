// 预览：Word / PPT / Excel 转成 PDF 或渲成 PNG。转换不自己做，交给常驻 dsh 进程里挂着的
// Office 套件服务（@deepseek-ai/dsh-office-kit），经 ACP 的 _sidemate/preview 请求过去（插件在 ./steer-plugin.mjs）。
// 这里只管拿进程、发请求、把回包并成对外的形状；错误只报四个码和原文 detail，界面文案不在这儿写。

import { join } from 'node:path'
import { appRoot } from '../paths.mjs'
import { daemonFor } from './daemon.mjs'
import { PREVIEW_METHOD } from './steer-plugin.mjs'

// 插件回的错分到四个码上（原文 detail 照带出去）：
//   unavailable：服务不在（这个 dsh 没挂 office-kit，或进程本身起不来）；
//   unsupported：这件事不做（kind / path 不对、格式不支持、文件太大）；
//   unreadable：文件读不了；
//   failed：转换本身失败。
function previewCodeOf(error) {
  const text = String(error?.message || error)
  if (/^office kit is not available/.test(text)) return 'unavailable'
  if (/^(kind must be|path is required)/.test(text)) return 'unsupported'
  if (/^(cannot read the file|not a regular file)/.test(text)) return 'unreadable'
  // 套件自己的码（OfficeKitError：preview failed: <code>: <原文>）
  if (/^(unsupported-format|input-too-large)/.test(text.replace(/^preview failed: /, ''))) return 'unsupported'
  if (error?.crashLoop === true || /^dsh (is not running|stopped|keeps crashing)/.test(text)) return 'unavailable'
  return 'failed'
}

// 回包并成对外的形状（对外的契约）。渲出来的那几张图原样带出去
// （插件给的 file / width / height / page? / sheet? 都在；多出来的字段不往外承诺）。
// 文档的总页数也带出去（pages）：套件知道这份文档有几页。
function previewResult(result) {
  const missingFonts = Array.isArray(result?.missingFonts) ? result.missingFonts : []
  if (result?.kind === 'images') {
    // dpi 也带出去：100% = 真实大小，CSS 像素 = 图像素 × 96 / dpi
    return { ok: true, kind: 'images', images: Array.isArray(result.images) ? result.images : [], pages: Number(result.pages) || 0, dpi: Number(result.dpi) || 0, missingFonts }
  }
  if (result?.kind === 'pdf') {
    return { ok: true, kind: 'pdf', path: result.path, pages: Number(result.pages) || 0, missingFonts }
  }
  return { ok: false, code: 'failed', detail: 'unexpected reply from the preview bridge' }
}

// 在常驻的 dsh 进程上发一条 _sidemate/preview（不为预览另起 dsh）。
// launch（起进程的那一套）由 ./index.mjs 传进来：这边不引 ./index.mjs，免得两个文件互相引。
// 照一轮任务的办法拿进程：lease → start → 请求 → 放手；
// 桌伴自己那个 dsh 家是常驻的（放手也不收），别的（测试里那些）没人用了就收掉。
export function previewInDaemon(request = {}, { lowRoot, launch } = {}) {
  const dshHome = join(lowRoot ?? appRoot(), 'dsh')
  const daemon = daemonFor(dshHome, () => launch(), { resident: dshHome === join(appRoot(), 'dsh') })
  const release = daemon.lease()
  return (async () => {
    try {
      await daemon.start()
      return previewResult(await daemon.request(PREVIEW_METHOD, request))
    } catch (error) {
      return { ok: false, code: previewCodeOf(error), detail: String(error?.message || error) }
    } finally {
      release()
    }
  })()
}
