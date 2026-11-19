// 模型这一摊落在程序数据目录下的几个文件：清单（model.json）、同意记录（useragreement.json），
// 能力状态（ability.json）、外部工具服务（mcp.json）。路径从 app/paths.mjs 拿，别处不自己拼。
import { appPaths, appRoot } from '../paths.mjs'

export function modelFiles(root = appRoot()) {
  const paths = appPaths(root)
  return {
    catalog: paths.model,
    consent: paths.agreement,
    ability: paths.ability,
    mcp: paths.mcp,
  }
}
