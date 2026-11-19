// 装不装确认卡：白底细线圆角，三行标签 + 内容（名称、来源、用途），底下一排按钮。
// 只摆用户拿主意要看的；方案不合格、装不成时多一行红字，细节在日志里。
// 单独一个文件：这张卡的画法跟 task.js 的对话流分开放。

// 确认卡的一行：左边 56 宽的次色标签，右边内容（可传节点）
function installRow(label, content) {
  const row = document.createElement('div')
  row.className = 'irow'
  const key = document.createElement('span')
  key.className = 'k'
  key.textContent = label
  const val = document.createElement('span')
  val.className = 'v'
  if (typeof content === 'string') val.textContent = content
  else for (const one of content) val.append(one)
  row.append(key, val)
  return row
}

// 查不过的不给「装上」；干活中三个都灰。
export function installEl(block, labels, act) {
  const card = block.install
  const el = document.createElement('article')
  el.className = 'install'
  el.dataset.id = card.id || ''
  const title = document.createElement('div')
  title.className = 'ititle'
  title.textContent = labels.installTitle
  el.append(title)
  el.append(installRow(labels.installName, card.name))
  // 来源：仓库地址和版本各一截，中间的空白由样式给（.parts），不写「·」
  const from = installRow(labels.installFrom, [card.source, card.ref].filter(Boolean).map((text) => {
    const part = document.createElement('span')
    part.textContent = text
    return part
  }))
  from.querySelector('.v').classList.add('parts')
  el.append(from)
  el.append(installRow(labels.installDoes, card.does))
  // 方案不合格：红字一句「技能无效」
  if (card.ok === false) {
    const bad = installRow('', '')
    for (const one of card.problems || []) {
      const span = document.createElement('span')
      span.className = 'bad'
      span.textContent = one
      bad.querySelector('.v').append(span)
    }
    el.append(bad)
  }
  // 装的时候没装上：红字写明原因，卡留着还能再点
  if (card.error) {
    const err = installRow('', '')
    const bad = document.createElement('span')
    bad.className = 'bad'
    bad.textContent = card.error
    err.querySelector('.v').append(bad)
    el.append(err)
  }
  const btns = document.createElement('div')
  btns.className = 'ibtns'
  if (card.canInstall) {
    const yes = document.createElement('button')
    yes.type = 'button'
    yes.className = 'yes'
    yes.textContent = labels.installYes
    yes.disabled = card.locked
    yes.addEventListener('click', () => act({ type: 'install-skill', id: card.id }))
    btns.append(yes)
  }
  const no = document.createElement('button')
  no.type = 'button'
  no.className = 'no'
  no.textContent = labels.installNo
  no.disabled = card.locked
  no.addEventListener('click', () => act({ type: 'install-drop', id: card.id }))
  btns.append(no)
  el.append(btns)
  return el
}
