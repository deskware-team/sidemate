// 桌伴自己的「不读本机和局域网」小插件：这里放插件文件的位置和挂它的补丁文字。
// 插件本体在同目录的 local-net-plugin.mjs（dsh 按路径加载它），判断地址的规矩在 net-guard.mjs。
//
// 什么时候挂：设置「能力」页里的「允许访问本地网络」默认关着，关着就挂这个插件；
// 用户打开那个开关就不挂（那时本机和局域网里的网页是可以读的）。
// 谁决定挂不挂：app/abilities/launch.mjs（那边读同一个开关）。

import { fileURLToPath } from 'node:url'

// 插件文件的实际位置：起进程前算出来，不写死在代码里（装到哪儿都对）
export const LOCAL_NET_PLUGIN_FILE = fileURLToPath(new URL('./local-net-plugin.mjs', import.meta.url))

// 补丁文字：插一行我们自己的插件（不改 dsh 原有的那些行）
export function localNetPatchYaml() {
  return [
    '# 桌伴自己的 dsh 补丁：插一行插件，拦住读本机和局域网的链接。',
    '- insert:',
    '    - id: sidemate-local-net',
    `      name: ${JSON.stringify(String(LOCAL_NET_PLUGIN_FILE))}`,
    '',
  ].join('\n')
}
