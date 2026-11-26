// 起 dsh 时叠上去的那几份补丁（--patch，按这个顺序）。从 ./index.mjs 拆出来，那边原样转出 patchFiles。

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const NAMES = [
  'office.patch.yml',
  'skill.patch.yml',
  'skill-dirs.patch.yml',
  'ask.patch.yml',
  'title.patch.yml',
  'rules.patch.yml',
  'present.patch.yml',
  'cache.patch.yml',
  'safety.patch.yml',
  'privacy.patch.yml',
]

export function patchFiles() {
  return NAMES.map((name) => join(here, name))
}
