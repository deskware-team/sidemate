# 桌伴 Sidemate

桌伴是 Windows 桌面上的一个小帮手：把文件拖给它，说一句要做什么，它写一份文件交给你。

它贴在屏幕顶边，平时只露一双眼睛。没有账号，没有服务器，也不收集使用数据；你的钥匙加密存在这台电脑上。

## 能做什么

- **换着用模型**：Kilo 模型（不用钥匙）、DeepSeek、GLM 模型（智谱），或者自己配一个 OpenAI / Anthropic 格式的接口。
- **写材料、画流程图**：自带「写材料」，推荐装上「画流程图」，画出来是 Word / PPT 里能直接改字的方框和箭头。
- **装技能、连服务**：导入技能文件夹或 .zip，也可以在对话里让它装（先给你看确认卡，你点了才下载）；用 MCP 连外面的服务。
- **定时新闻**：说一句想看什么、什么时候看，到点你的模型自己去搜、去读原文，每条都带它真打开过的链接。
- **任务窗**：干到一半能插话；成品在对话里是一张卡，能打开、另存为、拖到桌面；做完了再说一句接着改。

每一版具体改了什么，见 [docs](docs) 里的发版说明。

## 安装

1. 从 [Releases](https://github.com/deskware-team/sidemate/releases) 下载最新的 `sidemate-setup-<版本号>.exe`，双击安装。安装包没有签名，Windows 弹出提示时，点「更多信息」，再点「仍要运行」。
2. 第一次打开时选一个模型：贴上 DeepSeek 的钥匙点「测试」，或者选 GLM、Kilo 模型，也可以自己配置。测试通过就能用了。

DeepSeek 的钥匙在 [DeepSeek 开放平台](https://platform.deepseek.com/) 申请。

从 0.2 升到 0.3：0.3 不读 0.2 的钥匙和记录，要重新贴一次钥匙；0.2 的文件还在 `C:\Users\<你的用户名>\桌伴` 里。

## 隐私

桌伴没有账号和服务器，不收集使用数据。钥匙加密存在这台电脑上，干活时内容只发给你选的模型；用 Kilo 模型时，内容会传到境外的 Kilo AI 处理。详见 [PRIVACY.md](PRIVACY.md)。

## 许可

本仓库的代码用 MIT 许可，见 [LICENSE](LICENSE)。随包分发的第三方组件及其许可见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。

## 安全问题

发现安全问题请发邮件 hello@deskware.cn，不要开公开 issue。详见 [SECURITY.md](SECURITY.md)。

---

Sidemate is a small helper on the Windows desktop: drop files on it, say what you need, and it hands you a document.

See [README.en.md](README.en.md) for the English version.
