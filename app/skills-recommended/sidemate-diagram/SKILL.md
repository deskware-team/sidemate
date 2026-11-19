---
name: sidemate-diagram
description: 用桌伴随包脚本画流程图、组织分工图和时间线，输出到 Word 或 PPT；图里的方框和箭头是真形状，在 Word / PPT 里能选中改字、拖位置。
whenToUse: 用户要画流程图、组织架构图、分工图、项目时间线，或者要把这类图插进 Word / PPT 时。
---

# 画流程图

图要用**随包 Python 直接画成形状**：Word / PPT 里的每个方框、每条箭头都是能改的对象。不要先画 SVG 再想办法插进去——随包的 `python-docx` 和 `python-pptx` 都不认 SVG（`python-pptx` 靠 Pillow 读图，Pillow 不认 SVG；`python-docx` 的图片解析表里也没有 SVG），绕一圈只会退化成一张改不了的位图，白画一遍。

先调用 `load_workspace_dependencies`，用它给的随包 Python 运行本技能 `scripts/` 里的脚本；不要安装依赖，不要找系统 Python，不要起浏览器。脚本只用随包的 `python-pptx` / `python-docx` / `Pillow` / `lxml`，不联网。

下文用 `<python>` 代表随包 Python 的路径，用 `<skill>` 代表本技能目录。路径含空格时加引号。

## 1. 画一张图

先把图谱写成一份 UTF-8 JSON 放到工作区，再运行：

```text
<python> <skill>/scripts/draw_diagram.py 图谱.json
```

脚本的标准输出是一行 JSON：`path` 是成品绝对路径，`shapes` 是形状数，`connectors` 是连线数，`images` 是图片数（正常是 0），`texts` 是图上的文字。失败时 JSON 带 `error`，进程退出码非零。

命令行参数可以覆盖 JSON 里的设置：

- `--out 成品.pptx`：换输出文件。
- `--format pptx` 或 `--format docx`：换输出格式。
- `--into 已有文件.pptx` 或 `--into 已有文件.docx`：把图追加到已有文件末尾（PPT 追加一页，Word 追加一段）。
- `--mode png`：Word 里改用位图（一般是兜底，正常不要用）。

## 2. 图谱怎么写

```json
{
  "type": "flow",
  "title": "报销审批流程",
  "nodes": [
    { "id": "n1", "text": "员工提出申请" },
    { "id": "n2", "text": "直属主管审核" },
    { "id": "n3", "text": "金额超过 5000 元？", "shape": "diamond" },
    { "id": "n4", "text": "财务总监加签" },
    { "id": "n5", "text": "出纳打款" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "提交" },
    { "from": "n2", "to": "n3", "label": "通过" },
    { "from": "n3", "to": "n4", "label": "是" },
    { "from": "n4", "to": "n5", "label": "通过" },
    { "from": "n3", "to": "n2", "label": "驳回", "style": "dashed" }
  ],
  "output": { "format": "pptx", "file": "报销审批流程.pptx" }
}
```

字段：

- `type`：`flow` 流程图、`org` 组织分工图、`timeline` 时间线。默认 `flow`。
- `title`：图的标题，可以不写。
- `nodes`：节点数组。每项可以只写文字，也可以写 `{ "id", "text", "shape", "parent" }`。`id` 默认按顺序取 `n1`、`n2`；`shape` 认 `box`（方框）、`diamond`（判断菱形）、`start`（开始）、`end`（结束）、`note`（备注）；`parent` 只在 `org` 里用，指向父节点。
- `edges`：连线数组，每项 `{ "from", "to", "label", "style" }`。`style` 认 `solid`、`dashed`；`label` 写在箭头旁边。
- `output`：`format` 认 `pptx`、`docx`；`file` 是成品文件名（相对工作区）。

### 三种图

- **流程图**（`flow`）：按连线自动分层，一层一个框，从上往下排。判断点写 `shape: "diamond"`；退回上一步这类回路写 `style: "dashed"`，脚本会从右侧绕回来。同层放两个框就是并行的分支。
- **组织分工图**（`org`）：靠 `parent` 排成树，父节点在上、子节点在下，同一层的兄弟节点并排。职位名写在 `text` 里。
- **时间线**（`timeline`）：节点按数组顺序排在一条横轴上，轴上有编号圆点，文字在轴上方。

### 两种输出

- `pptx`：每个方框、每条箭头都是 PowerPoint 里的真形状（`p:sp` 和 `p:cxnSp`），能选中改字、拖位置、改颜色，没有位图。
- `docx`：同样是真形状（DrawingML 的 `wps:wsp`，文字放在形状自己的文本框里），在 Word 里能选中改字。脚本输出 `images: 0` 就说明没有偷偷塞位图。

## 3. 版式规矩（照这个写，脚本也照这个排）

- 字号：框里 14pt、线上标签 11pt、标题 22pt。中文统一微软雅黑，`latin`/`ea`/`cs` 三处都写上，PPT 和 Word 里才不会掉字体。
- 框和框之间至少留 30pt，框里的字最多占 192pt 宽，超了自动换行、框跟着长高。不要在一个框里塞一整段话。
- 箭头从框的下边中点连到下一个框的上边中点；同层分支从右边连到左边；回路走右侧通道，用虚线。线上标签放在线中点上方，别压着线。
- 一个框里最多两行字；三行以上说明该拆框。
- 图不能出页面：脚本会按页面大小整体缩放，但节点太多时字会变小，这时该拆成两张图，不要硬塞。

## 4. 出错了怎么办

- JSON 写错（少括号、末尾多逗号）：脚本报「第几行第几列」是什么错，按提示改 JSON 再跑。
- 字段写错（`shape` 拼错、`edges` 里 `from` 指向不存在的节点）：脚本报是哪一项、哪个节点，按提示改。
- 成品里图不见了：先看脚本输出的 `shapes` 和 `connectors` 是不是 0；是 0 就是图谱没解析出东西，不是文件的问题。
- 打开 Word 看不到形状：换 `--mode png` 兜底，但位图在 Word 里改不了，只能当最后手段，并在交付时说清楚是图不是可编辑形状。
- 脚本报缺依赖：不要自己 `pip install`，随包 Python 里本来就带着 `python-pptx` 和 `python-docx`，检查是不是用错了 Python。

## 5. 参考

版式规矩（字号、间距、箭头、留白、中文避让）参考了开源项目 `bybit-exchange/svg-diagram` 的 `SKILL.md`（MIT），只借鉴规范，没有复制它的代码，也没有随包它的工具和样例。
