// 界面文案（二）：设置窗
// 设置窗（模型、能力、新闻、用量、显示、关于和几个弹窗）。首次运行、密钥获取教程、同意页、早报页面的字在 ui-windows.mjs。
// 状态在 status.mjs，错误码在 errors.mjs。
// 安装 / 卸载弹窗的字在 build/installer.nsh（那个文件读不了 .mjs，字留在原处）。
// 每条上面一行注释说在哪、什么情况出现；{name} 是程序填进去的内容，括号里的名字别改。

export default {
  // ───────── 设置窗：左边目录和标题栏 ─────────
  "nav": {
    // 左边目录第一项，点它打开「模型」页
    "models": "模型",
    // 左边目录第二项，点它打开「能力」页
    "caps": "能力",
    // 左边目录第三项，点它打开「新闻」页
    "news": "新闻",
    // 左边目录第四项，点它打开「用量」页
    "usage": "用量",
    // 左边目录第五项，点它打开「显示」页
    "display": "显示",
    // 左边目录第六项，点它打开「关于」页
    "aboutPage": "关于",
    // 设置窗标题栏
    "title": "桌伴设置"
  },

  // ───────── 设置窗 · 模型页 ─────────
  "modelPage": {
    // 页面上方的黄字：默认模型现在选不了
    "warn": "默认模型不可用",
    // Kilo 模型那一行的圆点选不了时，鼠标停上去的说明
    "needConsent": "必须阅读并同意使用须知",
    // DeepSeek 那一行的圆点选不了时，鼠标停上去的说明
    "needKey": "需填入密钥",
    // 自定义条目那一行的小字：还没存密钥
    "noKey": "未填写密钥",
    // 自定义条目那一行的小字：OpenAI 那种接口
    "formatOpenai": "OpenAI 格式",
    // 自定义条目那一行的小字：Anthropic 那种接口
    "formatAnthropic": "Anthropic 格式",
    // 自定义条目那一行的小字：几个模型
    "modelCount": "{count} 个模型",
    // 密钥在界面上打码的样子：前四位 + *** + 后四位
    "maskedKey": "sk-xx***xxxx",
    // 密钥在界面上打码的样子：真的那把密钥的头尾
    "maskedFormat": "{head}***{tail}",
    // 密钥太短时打码的样子：只露三个点
    "maskedShort": "***",
    // 存着的密钥读不出来时，那一行的小字（跟任务窗横幅同一句）
    "keyBroken": "@stops.keyBroken",
    // Kilo 模型那一行的名字
    "kiloName": "Kilo 模型",
    // Kilo 模型那一行的按钮：看使用须知
    "kiloGuide": "使用须知",
    // 模型页底部：清单里没有 Kilo 时才出现的那个按钮
    "addKilo": "添加 Kilo 模型",
    // 删 Kilo 之前问的那一句：连同意一起撤
    "removeKiloConfirm": "删除 Kilo 模型？使用须知的同意也会撤回",
    // 并发上限那一格旁边的字
    "concurrency": "同时请求数",
    // 并发上限那一格的说明：0 是多少都不限
    "concurrencyHint": "0 表示不限",
    // DeepSeek 那一行的按钮：换一把密钥
    "changeKey": "修改密钥",
    // DeepSeek 那一行的按钮：把密钥删掉
    "removeKey": "删除密钥",
    // 自定义条目那一行的按钮：改这个条目
    "modify": "修改",
    // 自定义条目那一行的按钮：给这把密钥再加一个模型
    "addModel": "加模型",
    // 自定义条目那一行的按钮：删这个条目
    "remove": "删除",
    // 删自定义条目之前问的那一句
    "removeConfirm": "删除 {name}？密钥会一同被删除",
    // 条目名字右边的小标：自己加的
    "tagCustom": "@models.custom",
    // 条目名字右边的小标：现在正在用的
    "tagDefault": "默认",
    // DeepSeek 密钥框上面的占位字
    "keyPlaceholder": "贴上以 sk- 开头的 DeepSeek 密钥",
    // 保存模型/密钥时，正在跑的任务会被打断：先问这一句（弹窗里没有标题）
    "restartAsk": "编辑模型会中断已有会话",
    // 上面那个弹窗的按钮：照旧保存
    "restartAskOk": "继续保存",
    // 上面那个弹窗的按钮：算了，不保存（跟别的取消一样）
    "restartAskCancel": "@common.cancel",
    // 删掉正在用的模型之前问的那一句
    "deleteAsk": "删除模型会中断正在使用它的任务",
    // 上面那个弹窗的按钮：照旧删
    "deleteAskOk": "继续删除",
    // 上面那个弹窗的按钮：算了，不删（跟别的取消一样）
    "deleteAskCancel": "@common.cancel"
  },

  // ───────── 设置窗 · 自定义模型弹窗 ─────────
  "custom": {
    // 弹窗标题：新建的时候
    "titleAdd": "添加自定义模型",
    // 弹窗标题：给已有的条目再加一个模型
    "titleAddModel": "添加模型",
    // 下拉里的一项：GLM 那家
    "providerZhipu": "GLM",
    // 第三行的标签：哪种接口
    "labelFormat": "格式",
    // 第四行的标签：地址
    "labelUrl": "接口地址",
    // 第五行的标签：密钥
    "labelKey": "密钥",
    // 标准三项第一项：模型 ID
    "labelModelId": "模型 ID",
    // 标准三项旁边那行小字：去哪里查
    "hintWhere": "在服务商的模型说明里查",
    // 标准三项第一项旁边那行小字
    "hintModelId": "照服务商给的模型名填",
    // 标准三项没填全时说的哪一句
    "needId": "请填写模型 ID",
    // 标准三项没填全时说的哪一句：上下文窗口
    "needContext": "请填写上下文窗口",
    // 标准三项没填全时说的哪一句：最大输出
    "needMaxOutput": "请填写最大输出",
    // 高级那一段的标题
    "advanced": "高级",
    // 高级里的输入类型
    "labelInputType": "输入类型",
    // 输入类型里的文本
    "inputText": "文本",
    // 输入类型里的图片
    "inputImage": "@tag.image",
    // 高级里的推理等级：加一档、删一档、每档一个发送值
    "effortAdd": "＋ 添加档位",
    // 推理等级那一行：删掉这一档
    "effortRemove": "@modelPage.remove",
    // 推理等级那一行：这一档发给对方的值
    "effortValue": "发送值",
    // 高级里的思考参数格式
    "labelThinkingFormat": "思考参数格式",
    // 密钥框的占位字：新建的时候
    "keyPlaceholder": "输入密钥",
    // 密钥框下面那个按钮：试一下能不能用
    "test": "测试",
    // 试的时候，结果行上写的那句
    "testing": "测试中…",
    // 没填密钥时冒出来的红字
    "keyRequired": "@probe.empty",
    // 存下来了但没测通：那边忙、余额不够这类，原样把那边的错摆出来
    "savedWithError": "测试成功，模型返回：{error}",
    // 存下来了但没测通：其它原因
    "savedFailed": "测试失败，信息已保存",
    // 探针没接上（内部出错）
    "probeMissing": "测试不可用",
    // 每行右边的上下文数字
    "contextTokens": "上下文 {count}",
    // 「模型设置」第二层第二行的标签
    "labelContext": "上下文窗口",
    // 「模型设置」第二层第三行的标签
    "labelMaxTokens": "最大输出长度",
    // 「模型设置」第二层第四行的标签
    // 高级里的推理等级（每档一个档位和一个发送值）
    "labelThinking": "推理等级",
    // 数字下拉里打头的那一项
    "auto": "自动",
    // 上下文那一格没数时写的那句
    "byDefault": "按默认"
  },

  // ───────── 设置窗 · 能力页 ─────────
  "abilities": {
    // 「能力」页里第一个小标题
    "skills": "技能",
    // 「＋ 导入技能」按钮
    "import": "＋ 导入技能",
    // 「打开文件夹」按钮：把自己放的技能文件夹打开给用户看（跟小岛那边是同一句）
    "openFolder": "@top.openFolder",
    // 「能力」页里第三个小标题
    "mcp": "MCP",
    // 一个外部工具服务都没有时，列表里那句话
    "mcpEmpty": "无 MCP",
    // 自带技能的名字：写材料
    "skillWriting": "写材料",
    // 自带技能的第二行：写材料那一条
    "skillWritingNote": "列提纲、成段写、通读改",
    // 推荐技能的名字：画流程图
    "skillDiagram": "画流程图",
    // 推荐技能的第二行：画流程图那一条
    "skillDiagramNote": "流程图、分工图、时间线",
    // 技能名右边的小标：桌伴自带的
    "tagBuiltin": "内置",
    // 技能名右边的小标：推荐装的
    "tagRecommended": "推荐",
    // 技能名右边的小标：自己导入的
    "tagMine": "@models.custom",
    // 自己导入的技能，第二行写导入的日子
    "imported": "导入于 {date}",
    // 按用户的话装的技能，第二行开头那一段：哪天装的
    "aiInstalled": "对话中安装于 {date}",
    // 按用户的话装的技能，第二行最后那一段：许可证
    "license": "许可证 {name}",
    // 技能没写许可证时，第二行最后那一段
    "noLicense": "许可证未注明",
    // 技能行里那个仓库地址，鼠标停上去写的话
    "commit": "提交号 {commit}",
    // 技能行里那个仓库地址，鼠标停上去写的话（没有提交号时）
    "openRepo": "在浏览器中打开",
    // 技能行的按钮：删掉这个技能
    "remove": "@modelPage.remove",
    // 删技能之前问的那一句
    "removeConfirm": "删除「{name}」？",
    // 「能力」页里第二个小标题：联网搜索、读取网页那张卡
    "webTitle": "联网",
    // 联网搜索那一行的名字
    "search": "联网搜索",
    // 联网搜索那一行右边的小标
    "searchNeedKey": "需填入 DeepSeek 密钥",
    // 联网搜索那一行的第二行：这个月搜了几次
    "searchStat": "本月搜索 {count} 次",
    // 读网页那一行的名字
    "fetch": "读取网页",
    // 读网页那一行的第二行
    "fetchNote": "读取网页文字，无需密钥",
    // 「允许访问本地网络」那一行的名字
    "localNet": "允许访问本地网络",
    // 「允许访问本地网络」那一行的第二行：只说读网页那个工具
    "localNetNote": "打开后，读网页时可以访问本机和局域网里的地址",
    // 外部工具服务那一行的第二行：还没测过
    "mcpNotTested": "未测试",
    // 外部工具服务那一行的第二行：测通了
    "mcpOk": "@mcp.testOk",
    // 外部工具服务那一行的第二行：没连上
    "mcpFail": "连接失败：{reason}",
    // 外部工具服务那一行没连上时的原因（那边没说是哪个原因时用这句）
    "mcpFailReason": "@stops.other",
    // 只放行 GitHub 仓库地址，别的地址不开时说的话
    "repoOnly": "仅支持 GitHub 仓库地址",
    // 导入技能没导成、又说不出原因时的那一句
    "importFailed": "导入失败"
  },

  // ───────── 导入技能、对话里装技能时的话 ─────────
  // 导入（设置·能力）和对话里装技能（任务窗确认卡）出问题都只说下面这几类；哪个文件、哪条规矩没过写进日志。
  "skills": {
    // 系统选 zip 那个窗口里的文件类型
    "zipFilter": "zip 压缩包",
    // 太大：技能文件夹超过上限、文件太多、仓库太大、压缩包解开太大或条目太多
    "tooBig": "文件过大",
    // 不支持：选的不是文件夹或 .zip、压缩方式不认、带可执行文件、带符号链接
    "unsupported": "文件不支持",
    // 读不了：压缩包打不开或坏了、解压失败、拷文件失败、改不了 SKILL.md
    "readFailed": "文件读取失败",
    // 不存在：选的东西不见了、仓库里没有那个文件或那个仓库
    "notFound": "文件不存在",
    // 删技能时没有这个技能（名字不对、不在技能文件夹里也算）
    "noSuchSkill": "技能不存在",
    // 技能本身不合格：缺 SKILL.md、多了说明文件、没写名字、路径不安全、方案不对、仓库里有好几个技能
    "invalid": "技能无效",
    // 已经有同名的技能了
    "exists": "技能已存在",
    // 删技能时删不干净（文件正被占着）
    "notRemoved": "删除失败",
    // 导入成功（只回给调用方，界面不显示）
    "importOk": "已导入：{id}",
    // 删技能成功（只回给调用方，界面不显示）
    "removed": "已删除：{id}",
    // 技能说明文件里没写说明时补的那一句
    "descriptionFallback": "技能 {display}",
    // 技能导入的右键菜单里的一项：选文件夹
    "pickFolder": "选择文件夹…",
    // 技能导入的右键菜单里的一项：选 zip
    "pickZip": "选择 .zip…",
    // 系统选文件夹那个窗口的标题
    "pickFolderTitle": "选择技能文件夹",
    // 系统选 zip 那个窗口的标题
    "pickZipTitle": "选择 .zip"
  },

  // ───────── 设置窗 · 自定义 MCP 弹窗 ─────────
  "mcp": {
    // 弹窗标题：新建的时候
    "titleAdd": "添加 MCP",
    // 第一行的标签
    "labelHow": "连接方式",
    // 三块按钮：填网址
    "modeUrl": "填写网址",
    // 三块按钮：本机程序（在这台电脑上跑的那种，npx、uvx 起的那些）
    "modeLocal": "本机程序",
    // 三块按钮：粘贴配置
    "modeConfig": "粘贴配置",
    // 第三行的标签
    "labelUrl": "网址",
    // 本机程序那一页：程序那一行的标签
    "labelCommand": "程序",
    // 本机程序那一页：程序框的占位字
    "commandPlaceholder": "完整路径，或 npx 这类能直接运行的名字",
    // 本机程序那一页：参数框的标签
    "labelArgs": "参数（一行一个，选填）",
    // 本机程序那一页：密钥那一段的标签
    "labelEnvKey": "密钥（选填）",
    // 本机程序那一页：密钥那一行的左标签（放进哪个环境变量）
    "labelEnvName": "环境变量名",
    // 本机程序那一页：没填程序就点了「测一下」
    "testNeedCommand": "程序未填写",
    // 粘贴配置那一行的标签
    "labelConfig": "配置",
    // 粘贴框的占位字
    "configPlaceholder": "贴上 MCP 配置",
    // 粘贴里有好几个条目时，切回填网址那一页写的那句
    "multiPaste": "检测到 {count} 个配置，仅添加第一个",
    // 密钥放在哪那一段的标签
    "labelKeyWhere": "密钥位置（选填）",
    // 放法的两块按钮：放在请求头里
    "keyInHeader": "请求头",
    // 放法的两块按钮：放在网址里
    "keyInQuery": "网址参数",
    // 密钥那一行的右标签
    "labelKeyValue": "值",
    // 密钥框的占位字：以前存过一把
    "keySaved": "已保存，留空不修改",
    // 测完了：通了，有几个工具（一个都没有也是这句）。能力页那一行的第二行也是这句
    "testOk": "已连接 {count} 个工具",
    // 没填网址就点了「测一下」；粘贴的配置里没写网址也是这句
    "testNeedUrl": "网址未填写",
    // 底部按钮排左边的链接：删掉这个服务
    "removeLink": "删除 MCP",
    // 删服务之前问的那一句
    "removeConfirm": "@abilities.removeConfirm",
    // 底部按钮排里的链接：怎么填
    "howTo": "填写说明",
    // 「怎么填？」点开的那段说明
    "howToText": "网址以 https:// 开头；本机程序填完整路径或 npx 这类名字，参数一行一个；密钥及其位置见服务商说明",
    // 底部按钮排里的主按钮：存下来
    "save": "@common.save",
    // 没测就点「存下」时，主按钮左边的红字
    "needTest": "需测试通过",
    // 弹窗里的红字提醒
    "warn": "MCP 可读取、修改、发送数据，仅添加可信的服务",
    // 网址参数里夹带了密钥：要把密钥挪到「值」那一格，所以单说一句
    "badLeakedKey": "网址参数含密钥"
    // 配置的别的毛病（不完整、看不懂、放法不对、几把密钥）都说 common.badConfig，网址不对说 common.badUrl；
    // 「测试」失败说 stops.mcpKey / stops.mcpAddress / stops.mcpDown，后面跟码
  },

  // ───────── 设置窗 · 新闻页 ─────────
  "newsPage": {
    // 列表下面的按钮
    "add": "＋ 添加主题",
    // 第一个开关的标签
    "catchup": "休眠错过后补生成",
    // 第二个开关的标签
    "notify": "生成后在小岛提示",
    // 一个主题都没有时，列表里那句话
    "empty": "无主题",
    // 每一行右边的按钮：现在生成
    "generate": "立即生成",
    // 正在生成时那个按钮上的字
    "generating": "生成中…",
    // 第二行末尾：今天交了（不知道几点时没有时间那一段）
    "delivered": "今天{time} 已生成",
    // 第二行末尾：还没到点
    "notYet": "今天未到时间",
    // 第二行末尾：今天不是这个主题的日子
    "notToday": "今天不生成",
    // 第二行末尾：到点了没交出来
    "missed": "今天未生成",
    // 第二行末尾：到点时桌伴没开着，那一次没生成
    "notRun": "未生成：桌伴未运行",
    // 页面上方那一句提醒：没配密钥、也没搜索工具
    "noSearch": "没配置 DeepSeek 密钥和搜索工具，可能搜不到新闻",
    // 每一行第二行末尾写的权限：自动配置权限选了拒绝（默认，不显示）
    "permDeny": "自动配置权限：拒绝",
    // 每一行第二行末尾写的权限：自动配置权限选了允许
    "permAllow": "自动配置权限：允许",
    // 生成失败时，列表下面那行红字
    "failed": "@stops.newsError",
    // 删主题之前问的那一句
    "removeConfirm": "@abilities.removeConfirm",
    // 生成成功后的交代
    "done": "新闻已生成，共 {count} 条",
    // 这次一条也没有
    "nothing": "今日无新内容",
    // 用户自己按下停止：不是错，不带错误码
    "stopped": "已停止"
  },

  // ───────── 设置窗 · 加主题弹窗 ─────────
  "newsDialog": {
    // 弹窗标题：新建的时候
    "titleAdd": "添加主题",
    // 第一行的标签
    "labelName": "主题",
    // 第二行的标签
    "labelWant": "关注内容",
    // 第三行的标签
    "labelWhen": "时间",
    // 第四行的标签：后台生成时给不给模型运行权限
    "labelPermission": "自动配置权限",
    // 第四行标签后面那个 i，鼠标停上去显示的说明
    "permissionTip": "自动赋予模型后台生成时的运行权限，拒绝可能会导致生成失败",
    // 自动配置权限的两块按钮：拒绝（默认）
    "permissionDeny": "@perm.reject",
    // 自动配置权限的两块按钮：允许
    "permissionAllow": "允许",
    // 频率的三块按钮：每天
    "daily": "每天",
    // 频率的三块按钮：工作日
    "workdays": "工作日",
    // 频率的三块按钮：每周一
    "monday": "每周一",
    // 底部按钮排左边的链接
    "removeLink": "删除主题",
    // 底部按钮排：保存并生成一份
    "saveAndGenerate": "保存并生成",
    // 主题名字太短或太长
    "badName": "@common.badName",
    // 主题名字里有不能用的符号
    "badNameChars": "名称含非法字符",
    // 「想看什么」不对
    "badWant": "内容不合规",
    // 时间写错了
    "badTime": "时间格式错误",
    // 频率不对
    "badDays": "频率无效",
    // 已经有同名主题了
    "badDuplicate": "主题已存在",
    // 主题不完整
    "badIncomplete": "主题不完整"
  },

  // ───────── 设置窗 · 用量页 ─────────
  "usage": {
    // 标题下面那行：这个月模型一共处理了多少（输入加输出，跟模型服务后台的用量对得上）
    "heading": "{month} 月模型用量合计（输入加输出）",
    // 合计那个数后面的单位
    "wan": "万",
    // 小标题
    "recent": "最近 10 个任务",
    // 任务名是空的时候用这一句
    "taskFallback": "@history.emptyTitle"
  },

  // ───────── 设置窗 · 显示页 ─────────
  "display": {
    // 第一组的标题
    "font": "字号",
    // 第一组的档位：最小
    "small": "小",
    // 第一组的档位：标准
    "standard": "标准",
    // 第一组的档位：大
    "large": "大",
    // 第一组的档位：特大
    "xlarge": "特大",
    // 第二组的标题
    "island": "小岛大小"
  },

  // ───────── 设置窗 · 关于页 ─────────
  "aboutPage": {
    // 关于页的大标题
    "title": "桌伴 Sidemate",
    // 开机启动那一行的标题
    "loginTitle": "开机自动启动",
    // 「声明和许可」那一摞的第一行
    "docPrivacy": "隐私与使用声明",
    // 第三行
    "docThirdParty": "第三方组件许可",
    // 第四行
    "docLicense": "开源许可（MIT）",
    // Kilo 模型使用须知那一行的状态字：已经同意了
    "agreed": "已同意 v{version}",
    // 全文页右上角的同意状态：同意过，还带日子
    "agreedFull": "已于 {date} 同意 v{version}",
    // 全文页右上角的同意状态：同意过，默认模型还是 Kilo 模型
    "agreedFree": "已于 {date} 同意 v{version}，默认模型为 Kilo 模型",
    // 全文页右上角的同意状态：使用须知改版了
    "stale": "使用须知已更新，需重新同意",
    // 列表里那一行的状态字：使用须知改版了
    "staleShort": "使用须知已更新",
    // 全文页右上角的同意状态：撤回过
    "withdrawn": "已撤回，Kilo 模型已停用",
    // 列表里那一行的状态字：撤回过
    "withdrawnShort": "已撤回",
    // 列表里那一行的状态字：从来没同意过
    "never": "未同意",
    // 撤回同意的按钮
    "withdraw": "撤回同意",
    // 全文页左上角的返回按钮
    "back": "‹ 关于",
    // 全文页的文件没随包带上
    "docMissing": "文件缺失",
    // 官网那一行
    "site": "官网",
    // 源码那一行
    "source": "源码"
  },

  // ───────── 模型清单：校验和内置的那些名字 ─────────
  // 清单的毛病只有下面两句要用户照着改；别的（缺字段、格式、档位、数值、夹带密钥、条目不在、内置删不掉）
  // 都说 common.badConfig，地址不对说 common.badUrl，名字不对说 common.badName
  "catalog": {
    // 条目不合格：一个模型都没加
    "needModel": "至少添加一个模型",
    // 模型不合格：id 重复
    "dupModelId": "模型 id 重复",
    // 思考档位：关
    "effortOff": "关",
    // 思考档位：最低
    "effortMinimal": "最低",
    // 思考档位：低
    "effortLow": "低",
    // 思考档位：中
    "effortMedium": "中",
    // 思考档位：高
    "effortHigh": "高",
    // 思考档位：很高
    "effortXhigh": "很高",
    // 思考档位：最高
    "effortMax": "最高"
  },

  // ───────── 几处共用的字 ─────────
  "common": {
    // 名字（表单里那一行的标签）
    "name": "@install.name",
    // 名字不合规（各处共用这一句）
    "badName": "名称不合规",
    // 配置有毛病、又不用用户分开改的（模型清单、MCP 的校验都用这一句，哪条没过写进日志）
    "badConfig": "配置错误",
    // 网址不是 https、写得不像网址（模型清单、MCP 共用）
    "badUrl": "网址格式错误",
    // 改（列表里那一行的按钮）
    "edit": "@modelPage.modify",
    // 测一下（按钮）
    "test": "@custom.test",
    // 版本（版本号那一行）
    "version": "版本 {version}",
    // 测通了
    "probeOk": "测试成功",
    // Kilo 模型（Kilo 通道用的那个模型）
    "kiloModel": "@modelPage.kiloName",
    // 改（弹窗标题：改某一个条目）
    "titleEdit": "修改 {name}",
    // 存一下的按钮
    "save": "保存",
    // 算了的按钮
    "cancel": "取消",
    // 测一下并保存的按钮（设置里的密钥框、自定义模型弹窗）
    "testSave": "测试并保存",
    // 存不上
    "saveFailed": "@stops.saveFailed"
  },

  // ───────── 「测一下」失败时说的话 ─────────
  "probe": {
    // 没贴密钥就点了「测一下」
    "empty": "@stops.noKeyAny",
    // 密钥不对
    "key": "@stops.keyBroken",
    // 那边忙
    "busy": "服务繁忙",
    // 地址或模型名不对
    "address": "地址或模型名错误",
    // 连不上（设置里的「测一下」）
    "network": "连接失败",
    // 没测成（首次运行里的「测一下」）
    "failFirst": "@stops.probeFailed"
  }
}
