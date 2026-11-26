// 发给模型的话（harness）
//
// 拼进提示词、写进工作区给模型读、或者脚本回给模型的字。用户在界面上一般看不到。
// "lines" 是好几行的一段，程序按换行拼起来。
//
// 还有几处发给模型的话不在这里，是干活的程序（dsh）直接读的文件，改字直接改那个文件：
//   app/dsh/rules.patch.yml                           桌伴的干活规矩，每一轮都带给模型
//   app/skills/sidemate-writing/SKILL.md              写材料技能的说明：写方案、报告、总结时拿给模型
//   app/skills/sidemate-skill-install/SKILL.md        装技能的说明：用户说「帮我装一个……」时拿给模型
//   app/skills-recommended/sidemate-diagram/SKILL.md  画流程图技能的说明：开着时拿给模型
// app/dsh 下其它 .yml 和 app/dsh/models.mjs 里只有注释是中文，不发给模型。

export default {
  // ───────── 每一轮都带 ─────────
  // 全局规矩：每次开工写给模型。today 那句接在后面，模型写落款、日期时用
  "agents": {
    "text": "回话用 Markdown。分几件事说时，每件用「### 小标题」开头；粗体只用一对 **。给用户看的话一律用中文。工具没拿到结果、影响成品的，在回话里直接说哪一项没拿到、你是怎么处理的。材料里没有的时间、地点、人名、数字，不要自己补；缺了就写「待定」或「另行通知」，并在回话里说一声。干活过程中你说的每一段话用户都看得到：用用户听得懂的话说你在做什么、为什么，不提工具名、命令和报错原文。任务窗能直接画统计图：用户要看数字的对比、趋势、占比时，在回话里写一个 chart 代码块——```chart 单独一行，JSON 另起一行，``` 单独一行收尾，type 写 bar、line 或 pie：\n```chart\n{\"type\":\"bar\",\"title\":\"三家门店本周客流\",\"unit\":\"人次\",\"categories\":[\"东湖店\",\"南站店\"],\"series\":[{\"name\":\"本周\",\"data\":[2160,1980]}],\"source\":\"门店客流.xlsx · Sheet1 B2:B3\"}\n```\n数字只用材料里的，source 写出处。任务窗也能直接画流程图：用户要看流程、步骤、分工时，在回话里写一个 mermaid 代码块（flowchart、sequenceDiagram、timeline 都行），节点文字用中文。任务窗也能显示图片和公式：图片用 ![说明](文件名) 引用工作区里的图片文件；公式用 $...$（行内）或 $$...$$（单独一段）。",
    "today": "今天的日期是 {year}年{month}月{day}日。"
  },
  // 桌伴自己加进去的话前面带这个标记（点开新闻时的指路话），免得模型当成用户说的
  "deskHint": "（桌伴提示，不是用户说的）",
  // 重新打开一份新闻接着聊：点开后的第一句前面悄悄带上（用户看不到）。每份新闻自己一个文件夹，里面只有一份新闻
  "newsHint": "这份新闻的全文在工作区的「{file}」里",

  // ───────── 读链接 ─────────
  "web": {
    // 读的地址在本机或局域网里、被桌伴拦下来时，给模型的话（模型会转述给用户）
    "localNetDenied": "这个地址在本机或局域网里，桌伴默认不让读。要读的话，请让用户在设置「能力」里打开「允许访问本地网络」，然后再试一次。",
    // 地址查不出来（DNS 查不到或超时）时给模型的话：判断不了是不是本机或局域网，桌伴先不让读
    "localNetUnresolved": "这个地址查不到（域名解析不出来），没法确认它是不是本机或局域网里的地址，桌伴先不让读。要读的话，请让用户在设置「能力」里打开「允许访问本地网络」，然后再试一次。"
  },

  // ───────── 接着干 ─────────
  // 用户点「接着干」：桌伴替用户在同一个会话里发的那一句。原来的要求和文件 dsh 那边都记着，不再重发
  "continue": {
    "text": "接着干，把刚才没做完的接着做完。"
  },

  // ───────── 生成新闻 ─────────
  "news": {
    // 第一轮：想看什么、今天日期。sample 是下面那段样子，后面接 reported。
    // 主题名不写进来：名字是从「想看什么」总结出来的，写两样模型会当成两个要求（0.3 留下的旧名字曾把内容带偏）
    "prompt": {
      "lines": [
        "替桌伴找今天的新闻：你自己找、自己看，最后把挑好的交给我。",
        "",
        "- 想看什么：{want}",
        "- 今天日期：{date}",
        "",
        "## 怎么找",
        "",
        "- 用你手上的工具自己找：先联网搜，再把要紧的那几条打开看原文；「能力」里配好的外部工具服务也能用。",
        "- 只找 48 小时内的新闻，旧闻不要。",
        "- 一事一条：同一件事只留一条，别把几件事写成一件。",
        "- 报过的只有出了新进展才写进 progress，note 里说清这次的新进展；没新进展就不写。",
        "- note 只写原文里有的事实、数字、时间、人物和引语，没把握的不写。",
        "- headline 写粗体短标题。",
        "",
        "## 怎么交",
        "",
        "把填好的 JSON 放在一个 ```json 代码块里回给我。",
        "",
        "{sample}"
      ]
    },
    // 起名字：把那句话总结成 4 到 8 个字的主题名（后台问模型时用；名字用在卡片、右键菜单、新闻标题上）
    "nameAsk": {
      "lines": [
        "把下面这句话总结成 4 到 8 个字的主题名，像栏目名一样，用原话里的词，不要缩写。只回主题名，不要标点和引号：",
        "{want}"
      ]
    },
    // 交的样子：贴给模型看。more 接在后面
    "sample": {
      "lines": [
        "照这个样子填（这只是样子，不要照抄，url、site、headline、note 都要换成真的内容）：",
        "",
        "```json",
        "{skeleton}",
        "```",
        "",
        "- 最外层必须是 { }，不是 [ ]",
        "- today 挑 3–10 条；确实一条都没找到才留空"
      ],
      "more": "- 每条都要有 url：只能写这一轮你自己搜到或打开过的那个链接"
    },
    // 样子里每一项的占位说明。模型原样照抄回来的，桌伴当没填
    "skeleton": {
      "summary": "一句话总结今天这些新闻的整体动静",
      "note": "用一两句话说清这条为什么跟「{want}」有关",
      "url": "这一轮搜到或打开过的那个链接",
      "site": "网站名",
      "headline": "粗体短标题"
    },
    // 接在第一轮后面，列以前报过的标题。untitled 是没标题时的兜底，早报正文里的粗体标题也用它
    "reported": {
      "text": "## 报过的（这些以前报过，别再当新事报）",
      "untitled": "（没标题）"
    }
  },

  // ───────── 装能力：方案和没收下的技能 ─────────
  // 装、删的时候回给桌伴自己的话：用户和模型一般看不到，出错时进日志
  "installPlan": {
    // 工作区已经没了（装、删的时候）
    "workspaceBad": "工作区不对",
    // 技能名不合法（带路径、符号之类）
    "badName": "技能名不合法",
    // 工作区里没有方案
    "noPlan": "没有方案",
    // 没有这一份方案
    "noSuchPlan": "没有这个方案",
    // 这一份方案已经删掉
    "dropped": "已放弃：{id}",
    // 模型自己下的技能已经删掉
    "deleted": "已删掉：{id}",
    // 工作区里没有模型自己下的东西
    "noPending": "没有待装的东西",
    // 没有这一份
    "noSuchPending": "没有这个东西",
    // 删不掉：文件正被占着
    "notRemoved": "没删干净，可能有文件正被占着"
  },

  // 画流程图技能的画图脚本：图谱写错了、画图失败、--help
  "diagram": {
    "notObject": "图谱要是一个 JSON 对象，里面写 type、nodes 等字段",
    "badType": "type 只认 flow、org、timeline，写的是「{kind}」",
    "titleText": "title 只能是文字",
    "noNodes": "图里要有 nodes 数组，而且至少一个节点",
    "nodeItem": "nodes 里第 {index} 项不是对象，也不是文字",
    "nodeRepeat": "节点 id 重复了：{id}",
    "nodeEmpty": "节点 {id} 没有文字",
    "nodeShape": "节点 {id} 的 shape 只认 {shapes}，写的是「{shape}」",
    "edgesArray": "edges 要是一个数组",
    "edgeItem": "edges 里第 {index} 项不是对象",
    "edgeFrom": "第 {index} 条连线的 from 找不到节点：{id}",
    "edgeTo": "第 {index} 条连线的 to 找不到节点：{id}",
    "edgeLabel": "第 {index} 条连线的 label 只能是文字",
    "edgeStyle": "第 {index} 条连线的 style 只认 solid、dashed，写的是「{style}」",
    "outputObject": "output 要是一个对象",
    "outputFormat": "output.format 只认 pptx、docx，写的是「{format}」",
    "outputFile": "output.file 只能是文字",
    "outputMode": "output.mode 只认 shapes、png，写的是「{mode}」",
    "parentMissing": "节点 {id} 的 parent 找不到：{parent}",
    "unreadable": "读不到图谱文件：{error}",
    "badJson": "{name} 不是合法的 JSON：第 {line} 行第 {col} 列 {msg}",
    "noOutput": "没写输出文件：JSON 里给 output.file，或者用 --out",
    "failed": "画图失败：{error}",
    "help": "画流程图、组织分工图、时间线，输出 Word / PPT",
    "helpSpec": "图谱 JSON 文件",
    "helpOut": "输出文件（覆盖 JSON 里的 output.file）",
    "helpFormat": "输出格式（覆盖 JSON 里的 output.format）",
    "helpInto": "插进已有的 docx / pptx 末尾",
    "helpMode": "docx 用形状还是位图"
  },

  // 画图脚本里写死的数据：字体名、Word 里形状和连线的名字
  "diagramData": {
    // 图里中文字用的字体
    "font": "微软雅黑",
    // Word 里一个形状的名字
    "shapeName": "形状 {n}",
    // Word 里一条连线的名字
    "connectorName": "连线 {n}"
  }
}
