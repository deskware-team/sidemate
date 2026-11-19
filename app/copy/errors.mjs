// 错误码（Si）
//
// 只放用户看得到的字。给模型的话在 harness.mjs。
// 每个码分两级（codes 里的 level）：
//   block  报错：这一轮停了、或者做不下去。任务窗输入框上方一条红色横幅，带去设置、重来这些按钮。
//   notice 提示：不停，只告诉一声。同一个位置一行灰字，右边一个 ×，点掉或者发下一句就收起。
//   两种同时有时只显示报错。
// 那一行的样子：
//   停下来那句 · Si 码 错误，原文
// 「原文」是模型服务回来的原话；桌伴自己查出来的错没有原文，只到「错误」。
// 每个码什么意思、怎么归类，见《0.3-错误码表》。

export default {
  // 横幅那一行的样子。stop 是下面「停下来那句」里的一句，code 是 Si 码，raw 是原文（最多 80 个字）。
  // 设置·新闻页「现在生成」失败的那行红字也是这个样子。
  "line": {
    "text": "{stop} · {code} 错误，{raw}",
    // 没有原文时
    "short": "{stop} · {code} 错误"
  },
  // 模型请求的报错那一行：code 是 dsh 的码和 HTTP 状态（RATE_LIMIT 429），不是 Si 码
  "dshLine": "{stop} · {code}，{raw}",
  // 模型请求的报错那一行：没有原文时
  "dshLineShort": "{stop} · {code}",

  // ───────── 停下来那句：横幅最前面那句话 ─────────
  "stops": {
    // 模型忙、被限流，自动重试 5 次还是忙，才停下来用这句
    "busy": "模型忙，已保存执行进度",
    // 模型服务说请求有问题、或者它自己出错（自动重试 5 次还是不行），还有并发满了、平台过载，都用这句
    "fail": "模型请求失败，已保存执行进度",
    // 模型一直不回，自动重试 5 次还是不回；模型服务自己说请求超时也用这句
    "timeout": "模型响应超时，已保存执行进度",
    // 连不上模型服务（断网、代理、域名不对），自动重试 5 次还是连不上，用这句
    "broken": "模型连接中断，已保存执行进度",
    // 模型回来的东西坏了：说到一半断了、空的、格式不对
    "invalid": "模型响应无效，已保存执行进度",
    // 开工前：选的模型没填密钥。vendor 是这家模型的名字
    "noKey": "{vendor} 密钥未填写",
    // 开工前：没填密钥，又说不出是哪一家
    "noKeyAny": "密钥未填写",
    // 开工前：存着的密钥解不开；干活中模型服务说密钥不对（Si401）；设置·模型页那行小字、「测试」和 MCP「测试」说密钥不对也指到这句
    "keyBroken": "密钥无效",
    // 开工前：选的是 Kilo 模型，使用须知还没点同意，或者改版了要重新同意
    "consent": "@modelPage.needConsent",
    // 开工前：选的模型不在清单里了（被下架等）
    "missing": "模型不可用",
    // 设置·新闻页：没配 DeepSeek 密钥，生成不了新闻。「＋ 加一个主题」右边的小字也是这句
    "newsSearch": "仅支持 DeepSeek 原生搜索",
    // 设置·新闻页：今天那份新闻的文件夹建不起来
    "newsFolder": "路径不可用",
    // 设置·新闻页：一个能用的模型都没有
    "noModel": "无可用模型",
    // 干活的程序起不来，或者干到一半自己退出了
    "crash": "程序崩溃",
    // 模型发来的工具调用对不上，这个会话接不下去了，只能重来
    "toolcall": "会话状态错误",
    // 文件被别的程序占着（Word 或 WPS 开着），读不出来也存不进去（原件读不了不用这句：跳过，记成读不到）
    "locked": "文件被锁定：{name}",
    // 其它原因；也是什么都没说就停了时的兜底
    "other": "未知错误",
    // 贴的图不是 PNG、JPG、WebP 那几种
    "pasteType": "图片格式不支持",
    // 什么都没贴上
    "pasteNone": "粘贴失败",
    // 打开一条历史对话打不开
    "historyOpen": "对话打开失败",
    // 装能力：方案不在了；装的时候出了问题说导入技能那几句（文件过大、技能无效、连接失败……）
    "installFailed": "安装失败",
    // 设置·自定义模型「测一下」：地址不是 https
    "probeHttps": "地址无效",
    // 设置·自定义模型「测一下」：地址会跳到别处
    "probeRedirect": "@stops.probeHttps",
    // 设置·自定义模型「测一下」：说不清是什么毛病
    "probeFailed": "测试失败",
    // 设置·自定义模型：模型列表没拉到
    "noModelList": "模型列表获取失败",
    // 设置·MCP「测一下」：那边没认这把密钥
    "mcpKey": "@stops.keyBroken",
    // 设置·MCP「测一下」：那边没这个地址
    "mcpAddress": "@stops.probeHttps",
    // 设置·MCP「测一下」：连不上
    "mcpDown": "@probe.network",
    // 设置·MCP「测一下」：说不清是什么毛病、那边回的不是工具服务
    "mcpOther": "@stops.mcpDown",
    // 设置·MCP：本机程序找不到（不是完整路径，按名字在 PATH 里也找不到）
    "mcpNoCommand": "找不到这个程序",
    // 设置·自定义模型、MCP、加主题：存不上（这一类只有这一句、这一个码）
    "saveFailed": "保存失败",
    // 设置·模型：密钥存不进这台电脑
    "keyStoreFailed": "密钥保存失败",
    // 设置·新闻：清单里没这个主题
    "newsTopic": "主题不存在",
    // 设置·新闻：这次没找到能对上链接的新闻
    "newsNoMatch": "新闻未找到",
    // 设置·新闻：模型没交出选题
    "newsNoTopics": "选题为空",
    // 设置·新闻：生成的时候出了别的错
    "newsError": "生成失败"
  },

  // ───────── 错误码：每个码在什么情况下出现、哪一级、用哪句停下来的话 ─────────
  "codes": {
    // Si1xx 配置
    // 没填密钥（no api key）。存着的密钥解不开时用 keyBroken
    "Si101": { "level": "block", "stop": "noKey" },
    // Kilo 模型使用须知还没同意，或者改版了要重新同意（consent required）
    "Si102": { "level": "block", "stop": "consent" },
    // 选的模型不在清单里（model not in list）
    "Si103": { "level": "block", "stop": "missing" },
    // 新闻要联网搜，但没配 DeepSeek 密钥（news needs DeepSeek native search）
    "Si104": { "level": "block", "stop": "newsSearch" },

    // —— 设置这边的（都在 Si1xx 这一类里：都是「配置」类的毛病） ——
    // 设置·自定义模型「测一下」：地址不是 https（url must be https）
    "Si105": { "level": "block", "stop": "probeHttps" },
    // 设置·自定义模型「测一下」：地址会跳到别处（url redirects elsewhere）
    "Si106": { "level": "block", "stop": "probeRedirect" },
    // 设置·自定义模型：模型列表没拉到（model list unavailable）
    "Si108": { "level": "block", "stop": "noModelList" },
    // 设置·MCP：本机程序找不到（mcp command not found）
    "Si109": { "level": "block", "stop": "mcpNoCommand" },
    // 设置·MCP「测一下」：那边回的不是工具服务，也说不出是哪个毛病（mcp not a tool service）
    "Si110": { "level": "block", "stop": "mcpOther" },
    // 设置·新闻：清单里没这个主题（topic not found）
    "Si111": { "level": "block", "stop": "newsTopic" },

    // Si2xx 文件夹
    // 设置·新闻：今天的文件夹建不起来（news folder failed）
    "Si206": { "level": "block", "stop": "newsFolder" },

    // Si3xx 干活的时候出的错
    // 起不来，或者干到一半自己退出了（agent failed to start / exited）
    "Si301": { "level": "block", "stop": "crash" },
    // 模型的工具调用对不上，会话废了（tool call mismatch）
    "Si302": { "level": "block", "stop": "toolcall" },
    // 模型一直不回，自动重试 5 次还是不回（no reply），用「模型响应超时」那句
    "Si303": { "level": "block", "stop": "timeout" },
    // 模型回来的东西坏了：说到一半断了、空的、格式不对（bad reply）
    "Si305": { "level": "block", "stop": "invalid" },
    // Si4xx 模型服务说「你的请求有问题」，码就是它回的状态码
    // 请求格式不对（bad request）
    "Si400": { "level": "block", "stop": "fail" },
    // 密钥不对（invalid api key），用「密钥无效」那句
    "Si401": { "level": "block", "stop": "keyBroken" },
    // 余额不够（insufficient balance）
    "Si402": { "level": "block", "stop": "fail" },
    // 没权限用这个模型（forbidden）
    "Si403": { "level": "block", "stop": "fail" },
    // 没有这个模型（model not found）
    "Si404": { "level": "block", "stop": "fail" },
    // 请求超时（request timeout），用「模型响应超时」那句
    "Si408": { "level": "block", "stop": "timeout" },
    // 内容太长（request too large）
    "Si413": { "level": "block", "stop": "fail" },
    // 太忙、被限流（rate limit），自动重试 5 次还是忙，用「模型忙」那句
    "Si429": { "level": "block", "stop": "busy" },

    // Si5xx 模型服务自己出问题，码就是它回的状态码
    // 服务器出错（server error），自动重试 5 次还是不行，用「模型请求失败」那句
    "Si500": { "level": "block", "stop": "fail" },
    // 网关出错（bad gateway），自动重试 5 次还是不行，用「模型请求失败」那句
    "Si502": { "level": "block", "stop": "fail" },
    // 服务不可用、过载（service unavailable），自动重试 5 次还是不行，用「模型请求失败」那句
    "Si503": { "level": "block", "stop": "fail" },
    // 网关超时（gateway timeout），自动重试 5 次还是不行，用「模型请求失败」那句
    "Si504": { "level": "block", "stop": "fail" },

    // Si6xx 网络
    // 连不上模型服务（断网、代理、域名不对），自动重试 5 次还是连不上（cannot reach model service），用「模型连接中断」那句
    "Si601": { "level": "block", "stop": "broken" },

    // Si7xx 文件
    // 贴的图不是 PNG、JPG、WebP 那几种（paste type unsupported）
    "Si702": { "level": "notice", "stop": "pasteType" },
    // 什么都没贴上（paste empty）
    "Si704": { "level": "notice", "stop": "pasteNone" },

    // Si8xx 交付和原件
    // 交稿时输出的文件被 Word 或 WPS 开着、另存也不行（file locked）
    "Si803": { "level": "block", "stop": "locked" },
    // 设置·新闻：没找到能对上链接的新闻（no matched news）
    "Si805": { "level": "block", "stop": "newsNoMatch" },
    // 设置·新闻：模型没交出选题（no topics returned）
    "Si806": { "level": "block", "stop": "newsNoTopics" },

    // Si9xx 其它
    // 没归上类的：文件拷不进来、任务文件夹落在原件那个文件夹里等（other）
    "Si901": { "level": "block", "stop": "other" },
    // 打开一条历史对话打不开（history open failed）
    "Si902": { "level": "block", "stop": "historyOpen" },
    // 装能力：方案不在了，或者装的时候出了问题（install failed）。出了问题时前一句换成那一类（文件过大……）
    "Si906": { "level": "block", "stop": "installFailed" },
    // 设置这边：存不上（自定义模型、MCP、加主题都是这一类，只这一句、这一个码）
    "Si907": { "level": "block", "stop": "saveFailed" },
    // 设置·模型：密钥存不进这台电脑（keyring unavailable）
    "Si908": { "level": "block", "stop": "keyStoreFailed" }
  }
}
