# KaTeX

任务窗里把对话里的公式画成式的库。

- 版本：0.16.47
- 来源：npm 包 `katex@0.16.47` 的 `dist`（上游发布的单文件打包版：katex.min.js、katex.min.css）
- 许可：MIT，许可证原文见同目录的 `LICENSE`
- 网址：https://github.com/KaTeX/KaTeX

`fonts/` 里只留了 woff2 一种字体（上游 dist 里还有 woff 和 ttf，浏览器用 woff2 就够，
少带一半字体小一点）。`katex.min.css` 里的 `@font-face` 还写着 woff、ttf 的备用地址，
浏览器用不到那几条，不影响显示。

这个文件是上游的成品，一个字没改。桌伴不随包做 npm 安装：页面那边在
`app/task/math-view.js` 里按需插一个 `<script>` 和一个 `<link>` 指向它（对话里第一次
出现公式时才插），不拖慢任务窗启动。

`build/lines.mjs` 跳过 `app/vendor`：这里是第三方成品，不是手写代码。
