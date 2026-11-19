// 输入胶囊展开 / 收起的过渡。收起是横排的一行胶囊、展开是竖排三行，布局不同没法直接 transition：
// 先量旧高，切类后量新高，把 height 定在旧值、逼一次重排、再设成新值走 transition，
// transitionend 之后把行内 height 清掉还给自动。过渡中内容贴着底边摆（task.css 里 .open 的 justify-content）、
// overflow 裁住：框的底边不动、往上长 / 往下缩，右下角的发送钮看起来全程不动。
// 动画没走完又被反过来切（刚展开就失焦）：旧高是在过渡里量的当前值，从这儿接着走，不跳。
// 关了「显示动画」（prefers-reduced-motion）：直接切类，不过渡、也不等 transitionend。

export function createInputAnim({ wrap, input, reduce }) {
  let onEnd = null // 走着的这段过渡的收尾监听；被新的切换顶掉时先摘下来

  const off = () => {
    if (onEnd) { wrap.removeEventListener('transitionend', onEnd); onEnd = null }
  }

  // 落定：行内 height 还给自动，类切到最终的样子
  const settle = (open) => {
    off()
    wrap.classList.remove('morph', 'grow', 'shrink')
    wrap.classList.toggle('open', open)
    wrap.classList.toggle('fold', !open)
    wrap.style.height = ''
    input.rows = open ? 3 : 1
  }

  // 把 height 定在旧值这一下不许自己也走动画：过渡类先摘干净，再定值、逼一次重排
  const pin = (px) => {
    wrap.style.height = `${Math.round(px)}px`
    void wrap.offsetHeight
  }

  const to = (open) => {
    off()
    if (reduce()) { settle(open); return }
    const from = wrap.getBoundingClientRect().height // 旧高：还在过渡里就量到当前值
    // 收起的过程中一直摆着展开的样子（内容贴底、发送钮不动），只在最后才切成一行胶囊
    wrap.classList.remove('fold', 'grow', 'shrink')
    wrap.classList.add('open', 'morph')
    wrap.style.height = '' // 行内高先拿掉，才量得到自动高
    let target
    if (open) {
      input.rows = 3
      target = wrap.getBoundingClientRect().height // 展开后的自动高
    } else {
      // 量收起后的高：先把 fold 摆上量完马上换回来，同一帧内做完，画面不闪
      wrap.classList.add('fold')
      wrap.classList.remove('open')
      target = wrap.getBoundingClientRect().height
      wrap.classList.remove('fold')
      wrap.classList.add('open')
    }
    pin(from)
    wrap.classList.add(open ? 'grow' : 'shrink')
    wrap.style.height = `${Math.round(target)}px`
    // 新旧高几乎一样就不会有 transitionend，直接落定
    if (Math.abs(target - from) < 1) { settle(open); return }
    onEnd = (event) => {
      if (event.target !== wrap || event.propertyName !== 'height') return
      settle(open)
    }
    wrap.addEventListener('transitionend', onEnd)
  }

  return { to }
}
