# 桌伴 Sidemate

本项目基于 DeepSeek Harness 开发。桌伴是 Windows 桌面上的一个小帮手：把文件拖给它，说一句要做什么，它写一份文件交给你。

它贴在屏幕顶边，平时只露一双眼睛。没有账号，没有服务器，也不收集使用数据。

## 能做什么

- **多供应商模型**：
  - **DeepSeek**：贴上自己的 API key，按用量付费，支持 DeepSeek 原生工具。
  - **Kilo**：使用 Kilo 的网关，有次数限制，详见程序中的 Kilo 说明和 Kilo 官方的说明。
  - **自定义**：填地址、模型名和 API key，OpenAI 格式和 Anthropic 格式的接口都行。
- **写材料、画流程图**：自带「写材料」，推荐装上「画流程图」，画出来是 Word / PPT 里能直接改字的方框和箭头。
- **装 Skills、连 MCP**：导入技能文件夹或 .zip，也可以在对话里让它装（先给你看确认卡，你点了才下载）；用 MCP 连外面的服务。
- **定时新闻**：每个主题说一句想看什么、几点出，可以订好几个；到点你的模型自己去搜、去读原文，每条都带它真打开过的链接。
- **任务窗**：干到一半能插话；成品在对话里是一张卡，能打开、另存为、拖到桌面；做完了再说一句接着改。
- **预览**：Word、PPT、PDF、Excel、图片和网页，在桌伴里直接看，能缩放、另存为。
- **对话里的图**：统计图、流程图、公式和图片直接显示在回话里，图上点右键能另存。

每一版具体改了什么，见 [docs](docs) 里的发版说明。

## 安装

1. 从 [Releases](https://github.com/deskware-team/sidemate/releases) 下载最新的 `sidemate-setup-<版本号>.exe`，双击安装。安装包没有签名，Windows 弹出提示时，点「更多信息」，再点「仍要运行」。
2. 第一次打开时选一个模型：贴上 DeepSeek 的 API key 点「测试」，也可以自己配置别的模型。测试通过就能用了。

DeepSeek 的 API key 在 [DeepSeek 开放平台](https://platform.deepseek.com/) 申请。

从 0.3 升到 0.4：直接装新版，API key、对话、新闻和设置都接着用。

从 0.2 升到 0.3：0.3 不读 0.2 的 API key 和记录，要重新贴一次 API key；0.2 的文件还在 `C:\Users\<你的用户名>\桌伴` 里。

## 隐私

桌伴没有账号和服务器，不收集使用数据。用 Kilo 模型时，内容会传到 Kilo AI 处理。详见 [PRIVACY.md](PRIVACY.md)。

## 许可与商标

本仓库中桌伴自身的源代码依照 MIT 许可发布，见 [LICENSE](LICENSE)；该许可不适用于第三方组件。桌伴基于 DeepSeek Harness（著作权人 DeepSeek，MIT 许可）开发，随包分发的 DeepSeek Harness 及其他第三方组件按其各自的许可协议分发，见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。

DeepSeek、DeepSeek Harness、Kilo 等名称及相关标识归其各自权利人所有。桌伴是独立开发的非官方项目，与上述权利人不存在隶属、合作、授权或背书关系；本文提及上述名称，仅用于说明所使用的开源组件或所兼容的第三方服务。

## 安全问题

发现安全问题请发邮件 hello@deskware.cn，不要开公开 issue。详见 [SECURITY.md](SECURITY.md)。

---

Sidemate is a small helper on the Windows desktop, developed on DeepSeek Harness: drop files on it, say what you need, and it hands you a document.

See [README.en.md](README.en.md) for the English version.
