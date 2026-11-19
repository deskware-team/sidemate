// 起任务前把能力（技能开关、外部工具服务）接给 dsh：纯 node，不引 electron。
// 外部工具服务按 ACP 原生做法随会话参数传（mcpServers）：钥匙不进补丁、不进环境变量。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listSkills, skillsPatchYaml } from './skills.mjs'
import { loadMcp, mcpToolsFor } from './mcp.mjs'
import { localNetPatchYaml } from '../dsh/local-net.mjs'
import { appPaths } from '../paths.mjs'
import { t } from '../copy/copy.mjs'

// 能力要用的目录和文件：repo 由调用方给；deskRoot 是程序数据根（%LOCALAPPDATA%\sidemate），
// 技能目录、ability.json、mcp.json 都从 app/paths.mjs 拿，只在这里定一次。
// 技能开关在 ability.json，外部工具条目在 mcp.json（两个文件分开）。
export function abilityFiles({ repo, deskRoot } = {}) {
  const r = typeof repo === 'string' ? repo : ''
  const d = typeof deskRoot === 'string' ? deskRoot : ''
  const paths = appPaths(d)
  return {
    bundledDir: join(r, 'app', 'skills'),
    recommendedDir: join(r, 'app', 'skills-recommended'),
    userDir: paths.skills,
    stateFile: paths.ability,
    mcpFile: paths.mcp,
  }
}

// 联网搜索和读网页的开关存在 ability.json 的 tools 字段里，
// 「允许访问本地网络」那个开关也在那儿（默认关）。
// 没有这个字段、字段缺了、文件坏了都当搜索和读网页开着、本机网络关着（跟没记过开关一样）。
// 读不出文件时叫一下 onError（带一句不带钥匙的日志），但不让任务起不来。
export function readTools(file, onError) {
  const out = { search: true, fetch: true, localNet: false }
  try {
    if (typeof file !== 'string' || file === '') return out
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const tools = data && typeof data === 'object' ? data.tools : null
    if (!tools || typeof tools !== 'object') return out
    if (typeof tools.search === 'boolean') out.search = tools.search
    if (typeof tools.fetch === 'boolean') out.fetch = tools.fetch
    if (typeof tools.localNet === 'boolean') out.localNet = tools.localNet
    return out
  } catch (error) {
    if (typeof onError === 'function') onError(error)
    return out
  }
}

// 联网搜索/读网页交给 dsh 的补丁：两个都开时什么都不放（dsh 原样就是都开）。
// 要放的时候重写 tool-web 这一行的 config——整个 config 换掉、不合并，
// 所以 dsh 那行里的 searchTimeoutMs: 60000 要照抄上，不然搜索的时限就掉回 30 秒。
export function webPatchYaml(tools = {}) {
  const search = tools?.search === false ? false : true
  const fetch = tools?.fetch === false ? false : true
  if (search && fetch) return ''
  return [
    '- id: tool-web',
    '  config:',
    `    search: ${search}`,
    `    fetch: ${fetch}`,
    '    searchTimeoutMs: 60000',
    '',
  ].join('\n')
}

// 算这一轮任务要交给 dsh 的能力：技能补丁在前、联网搜索/读网页补丁最后，
// 外部工具服务不进补丁，按 ACP 原生做法放在 mcpServers 里随会话参数传。
// 任何一步出错都不能让任务起不来：技能那步出错就不放技能补丁，
// 外部工具那步出错就不带外部工具服务，各记一句不带钥匙的日志。
// 联网搜索要不要挂由 dsh 自己定：没有 DeepSeek 凭据时，dsh 会把 web_search 从那一次请求里撤掉，
// 这里只管用户在「能力」页上的开关（关掉搜索或读网页时才写 tool-web 那一行）。
export function abilitiesForTask({ files, keyring, log } = {}) {
  const say = typeof log === 'function' ? log : () => {}
  const patchTexts = []
  let mcpServers = []
  let mcpSecrets = []
  try {
    if (!files || typeof files !== 'object') throw new TypeError('ability files missing')
    // 名字不合 dsh 规矩的技能在导入那一刻就改好了（./skills.mjs 的 importSkill），这里不改
    const text = skillsPatchYaml(listSkills(files))
    if (text !== '') patchTexts.push(text)
  } catch (error) {
    patchTexts.length = 0
    say(`abilities skills skipped: ${String(error?.message || error)}`)
  }
  try {
    const tools = mcpToolsFor(loadMcp(files?.mcpFile), keyring)
    mcpServers = tools.servers
    mcpSecrets = tools.secrets
  } catch (error) {
    mcpServers = []
    mcpSecrets = []
    say(`abilities mcp skipped: ${String(error?.message || error)}`)
  }
  try {
    const tools = readTools(files?.stateFile, (error) => say(`abilities web skipped: ${String(error?.message || error)}`))
    const text = webPatchYaml({ search: tools.search, fetch: tools.fetch })
    if (text !== '') patchTexts.push(text)
    // 「允许访问本地网络」默认关：关着就挂上拦本机/局域网的插件（app/dsh/local-net.mjs），
    // 用户打开那个开关就不挂，那时本机和局域网里的网页是可以读的。
    if (tools.localNet !== true) patchTexts.push(localNetPatchYaml())
  } catch (error) {
    say(`abilities web skipped: ${String(error?.message || error)}`)
  }
  return { patchTexts, env: {}, mcpServers, mcpSecrets }
}

// 工具调用失败的提示：技能没找到 St403、MCP 的工具 St402、别的工具 St401。
// MCP 的工具名是 mcp__<服务>__<工具>，把服务名换成界面上那个名字，用户才看得懂是谁没调通。
export function toolFailNote(name, files, input) {
  const raw = String(name ?? '').trim()
  // 技能工具：说的是哪个技能没找到；模型没说是哪个就照工具名说
  if (raw === 'skill') {
    const wanted = input && typeof input === 'object' ? String(input.name ?? input.skill ?? '').trim() : ''
    return t('St403', { name: wanted || raw })
  }
  const matched = /^mcp__([a-z0-9-]+)__(.+)$/.exec(raw)
  if (!matched) return t('St401', { name: raw })
  let label = matched[1]
  try {
    const entry = loadMcp(files?.mcpFile).find((one) => {
      if (!one || typeof one.id !== 'string') return false
      const id = one.id
      const server = id.startsWith('mcp-') && id.length > 4 ? id.slice(4) : id
      return server === matched[1]
    })
    if (entry && typeof entry.name === 'string' && entry.name.trim() !== '') label = entry.name.trim()
  } catch {
    // 读不出来就用服务名
  }
  return t('St402', { name: label })
}

// 把能力并进算好的模型选项：能力的补丁排在模型补丁后面（后面的盖前面的），
// 外部工具服务（mcpServers）和它们的钥匙（mcpSecrets）跟着能力走，其他字段一个不动；
// 模型没算成（ok 不是 true）就原样还回去。
export function withAbilities(picked, extra) {
  if (!picked || typeof picked !== 'object' || picked.ok !== true) return picked
  const add = extra && typeof extra === 'object' ? extra : {}
  const baseTexts = Array.isArray(picked.patchTexts) ? picked.patchTexts : []
  const addTexts = Array.isArray(add.patchTexts) ? add.patchTexts : []
  const baseEnv = picked.env && typeof picked.env === 'object' ? picked.env : {}
  const addEnv = add.env && typeof add.env === 'object' ? add.env : {}
  return {
    ...picked,
    patchTexts: [...baseTexts, ...addTexts],
    env: { ...baseEnv, ...addEnv },
    mcpServers: [...(Array.isArray(picked.mcpServers) ? picked.mcpServers : []), ...(Array.isArray(add.mcpServers) ? add.mcpServers : [])],
    mcpSecrets: [...(Array.isArray(picked.mcpSecrets) ? picked.mcpSecrets : []), ...(Array.isArray(add.mcpSecrets) ? add.mcpSecrets : [])],
  }
}
