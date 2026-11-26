// 界面文案（三）：设置以外的窗口
// 首次运行、密钥获取教程、同意页（Kilo 模型使用须知）、早报页面、预览窗。设置窗的字在 ui-settings.mjs。
// 状态在 status.mjs，错误码在 errors.mjs。
// 每条上面一行注释说在哪、什么情况出现；{name} 是程序填进去的内容，括号里的名字别改。

export default {
  // ───────── 窗口右上角 ─────────
  "frame": {
    // 设置、首次运行、Kilo 使用须知、卸载这几个窗口右上角那个圆形关闭按钮（鼠标停上去的提示）
    "close": "@input.dismiss"
  },

  // ───────── 卸载前的确认框 ─────────
  "uninstall": {
    // 窗口标题（任务栏上看得到）
    "title": "卸载桌伴",
    // 框里那一句
    "confirm": "确定卸载桌伴吗？",
    // 勾选那一项：默认不勾
    "wipe": "同时删除全部配置和记录（包括任务里生成的文件，删除后无法恢复）",
    // 不卸了
    "cancel": "@common.cancel",
    // 卸载
    "ok": "卸载"
  },

  // ───────── 首次运行 ─────────
  "firstRun": {
    // 首次运行窗第一屏的大标题
    "aboutTitle": "关于桌伴",
    // 第一屏第 1 句：桌伴是什么、能做什么
    "about1": "桌伴是一个基于 DeepSeek Harness 项目开发的轻量化工具，用于协助用户完成日常任务，如根据文件撰写 Word 文档、绘制流程图、生成每日新闻",
    // 第一屏第 2 句：谁在干活、会碰什么
    "about2": "任务由所选模型执行，执行中可能读取本机文件、访问网络，请只提供愿意交给模型处理的内容",
    // 第一屏第 3 句：密钥放在哪、什么时候用（点「测试」也会发一次，见 PRIVACY.md）
    "about3": "密钥加密保存在本机，仅在执行任务和测试时使用",
    // 第一屏的按钮
    "start": "开始",
    // 第二屏的大标题
    "modelTitle": "@models.pickTitle",
    // 推荐块的小标题
    "deepseekTitle": "DeepSeek 密钥",
    // 推荐块右上角的小标
    "recommend": "@abilities.tagRecommended",
    // DeepSeek 密钥框的占位字
    "deepseekPlaceholder": "贴上 DeepSeek 密钥",
    // 测试的时候，结果行上写的那句
    "testing": "@custom.testing",
    // 密钥获取教程那个链接
    "guide": "获取密钥",
    // 「其他方式」的小标题
    "otherTitle": "其他方式",
    // 其他方式第三项：Kilo 模型
    "otherKilo": "@common.kiloModel",
    // GLM 那一屏的大标题
    "zhipuTitle": "GLM 模型",
    // GLM 密钥框的占位字
    "zhipuPlaceholder": "贴上 GLM 密钥",
    // GLM 那一屏的主按钮
    "zhipuStart": "开始使用",
    // 「自己配置模型」那一屏的大标题
    "customTitle": "自定义模型",
    // 「自己配置模型」那一屏标题下面那行：去设置窗里配
    "customHint": "请在设置窗口的「模型」页添加模型并设为默认，再点「完成」",
    // 「自己配置模型」那一屏的按钮
    "customOk": "完成",
    // 「自己配置模型」那一屏：还没配好
    "customNotReady": "配置未完成",
    // 各屏左上角的返回按钮
    "back": "‹ 返回",
    // 第三屏的按钮
    "ok": "确定",
    // 不需要贴密钥的按钮（占位）
    "noKeyNeeded": "无需密钥",
    // 首次运行窗的标题栏
    "titlebar": "@sidemate"
  },

  // ───────── 密钥获取教程 ─────────
  "guide": {
    // 教程页的标题：DeepSeek
    "deepseekTitle": "获取 DeepSeek 密钥",
    // 教程页的开头：DeepSeek
    "deepseekIntro": "密钥绑定个人账号和余额，约需 5 分钟",
    // 第 1 步：DeepSeek
    "deepseekStep1": "打开 DeepSeek 开放平台，用手机号注册并登录",
    // 第 2 步：DeepSeek
    "deepseekStep2": "完成实名认证并充值，余额为 0 时不可用",
    // 第 3 步：DeepSeek
    "deepseekStep3": "进入「API keys」，点击「创建 API key」",
    // 第 4 步：DeepSeek
    "deepseekStep4": "复制以 sk- 开头的密钥，密钥仅显示一次",
    // 第 5 步：DeepSeek
    "deepseekStep5": "粘贴到桌伴的密钥框并测试",
    // 结尾：DeepSeek
    "deepseekOutro": "请勿向他人泄露密钥，向他人分享密钥可能造成损失，具体说明以 DeepSeek 官方页面为准",
    // 官方说明那个链接：DeepSeek
    "deepseekDocs": "官方说明：首次调用 API",
    // 教程页的标题：GLM
    "zhipuTitle": "获取 GLM 密钥",
    // 教程页的开头：GLM
    "zhipuIntro": "GLM-4.7-Flash 注册后可用，模型服务收费以官方公告为准",
    // 第 1 步：GLM
    "zhipuStep1": "打开开放平台，点击右上角「注册/登录」",
    // 第 2 步：GLM
    "zhipuStep2": "登录后进入个人中心，点击「API Keys」，新建 API Key",
    // 第 3 步：GLM
    "zhipuStep3": "类型选择「模型标准 API」，不同套餐的密钥不通用",
    // 第 4 步：GLM
    "zhipuStep4": "复制密钥，粘贴到桌伴的密钥框",
    // 第 5 步：GLM。几个任务同时跑时它会报忙，在这里先说一声
    "zhipuStep5": "默认模型 GLM-4.7-Flash 同一时间仅处理一个请求",
    // 结尾：GLM
    "zhipuOutro": "以官方页面为准",
    // 官方说明那个链接：GLM
    "zhipuDocs": "官方说明：快速开始",
    // 带链接那一步的按钮
    "openOfficial": "打开官方页面 ↗"
  },

  // ───────── 同意页（Kilo 模型使用须知） ─────────
  // 五条要点在一屏里一起列，第 1 条是两句话，所以五条都带句号
  "consent": {
    // 同意窗的大标题
    "title": "Kilo 模型使用须知",
    // 要点第 1 条
    "point1": "Kilo 模型由第三方（Kilo AI）提供。桌伴不提供模型服务，也不经手你的数据。",
    // 要点第 2 条
    "point2": "你发送的内容将传输至 Kilo AI，由 Kilo AI 及其调用的模型处理；处理地点、是否记录和作何用途，以 Kilo AI 的条款为准。",
    // 要点第 3 条
    "point3": "使用模型请遵守法律和使用条款，请勿发送个人敏感信息、商业秘密及其他依法不得对外提供的数据。",
    // 要点第 4 条
    "point4": "额度和可用性由 Kilo AI 决定，可能随时变更或停止。",
    // 要点第 5 条
    "point5": "输出内容由 Kilo AI 调用的模型生成，可能有误，请自行核实；桌伴开发者不对 Kilo AI 的数据处理、服务变更和生成内容负责。",
    // 条款全文框里的标题（版本号在窗口顶上已经写了，这里不再写）
    "termsTitle": "《{title}》",
    // 条款正文里那一行「版本 1.1」的开头两个字
    "versionWord": "版本",
    // 条款全文框下面那行提示
    "scrollHint": "↓ 滚动到底部后可勾选",
    // 第一个勾选框旁边的字
    "checkTerms": "我已阅读并同意使用须知",
    // 第二个勾选框旁边的字
    "checkCross": "我同意将发送的内容传输至 Kilo AI 处理",
    // 底部左边的按钮
    "decline": "不同意",
    // 底部右边的按钮
    "agree": "同意",
    // 写盘失败时的提示
    "writeFailed": "@stops.saveFailed",
    // 两个没都勾时的提示
    "needBoth": "必须勾选两项"
  },

  // ───────── 早报页面 ─────────
  "report": {
    // 一期新闻的文件名：放在主题那一期的文件夹里，桌伴和模型都按这个名字找
    "file": "新闻.md",
    // 早报文件的第一行标题（主题和日期之间空一格，不用「·」）
    "title": "{topic} {date} 新闻",
    // 早报里的一节标题：有当天的新消息
    "sectionToday": "## 今天",
    // 早报里的一节标题：有新进展
    "sectionProgress": "## 进展",
    // 每条下面的来源行
    "source": "来源：{name}",
    // 模型没给标题时，来源行里用的那个兜底
    "fallbackTitle": "原文",
    // 早报最后一行
    "footer": "共参考 {count} 个来源"
  },

  // ───────── 预览窗 ─────────
  "preview": {
    // 预览窗标题栏上那一句（左边）和窗口标题（任务栏上看得到）
    "title": "预览",
    // 左栏第一组的名字：任务文件夹根上的文件（成品）
    "groupDone": "成品",
    // 左栏第二组的名字：received 里的文件（材料）
    "groupMaterial": "材料",
    // 右上角那个按钮：用电脑上的程序打开这份文件
    "open": "@output.open",
    // 右上角那个按钮：另存为（系统另存为对话框）
    "saveAs": "@output.saveAs",
    // 顶条右边那个按钮：在文件夹里显示（选中当前这一份）
    "reveal": "@output.reveal",
    // 类型名：Word 文档
    "kindWord": "Word",
    // 类型名：PPT 演示稿
    "kindPpt": "PPT",
    // 类型名：Excel 表格
    "kindExcel": "Excel",
    // 类型名：PDF 文件
    "kindPdf": "PDF",
    // 类型名：图片
    "kindImage": "@tag.image",
    // 类型名：网页
    "kindWeb": "网页",
    // 类型名：文本
    "kindText": "@custom.inputText",
    // 类型名：压缩包
    "kindZip": "压缩包",
    // 类型名：别的文件
    "kindFile": "@input.fileLabel",
    // 类型块上的字：图片
    "badgeImage": "图",
    // 类型块上的字：文本（别的文件也用它）
    "badgeText": "文",
    // 左栏「材料」那一组每一行下面的说明：这份是你给的
    "noteMaterial": "{kind} · 你给的",
    // 上条下面那行说明：这份是只读的
    "noteReadonly": "{kind} · 只读",
    // 上条下面那行说明：这份有几页
    "notePages": "{kind} · {n} 页 · 只读",
    // 上条下面那行说明：这份有几张表
    "noteSheets": "{kind} · {n} 张表 · 只读",
    // 底条上那句话：这份共有几页
    "pages": "共 {n} 页",
    // 底条右边那个按钮：把页宽撑满画布
    "zoomFit": "适应宽度",
    // 底条右边那个「−」按钮：缩小一点（鼠标停在上面时的提示）
    "zoomOut": "缩小",
    // 底条右边那个「＋」按钮：放大一点（鼠标停在上面时的提示）
    "zoomIn": "放大",
    // 底条右边那几个字：现在放大到百分之几
    "zoomValue": "{n}%",
    // 页数太多时最后一页下面那一句：后面的页看不了
    "morePages": "这里只显示前 {n} 页，后面的用电脑上的程序打开看",
    // 还在转（还没转出来）时画布中间那一句
    "loading": "正在打开…",
    // 看不了的那一块：标题
    "cannotTitle": "这个文件在这里看不了",
    // 看不了的那一块：说明（这种类型这里看不了）
    "cannotUnsupported": "可以用电脑上的程序打开",
    // 看不了的那一块：说明（转出来失败或者读不了）
    "cannotFailed": "这份没转出来，可以用电脑上的程序打开",
    // 看不了的那一块：说明（预览服务还没准备好）
    "cannotUnavailable": "预览还没准备好，可以用电脑上的程序打开"
  },
}
