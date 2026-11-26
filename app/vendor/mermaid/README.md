# mermaid

任务窗里把对话里的 mermaid 代码块画成流程图用的库。

- 版本：11.17.2
- 来源：npm 包 `mermaid@11.17.2` 的 `dist/mermaid.min.js`（上游发布的单文件打包版）
- 许可：MIT，许可证原文见同目录的 `LICENSE`
- 网址：https://github.com/mermaid-js/mermaid

这个文件是上游的成品，一个字没改。桌伴不随包做 npm 安装：页面那边在
`app/task/mermaid-view.js` 里按需插一个 `<script>` 指向它（对话里第一次出现
mermaid 代码块时才插），不拖慢任务窗启动。

`build/lines.mjs` 跳过 `app/vendor`：这里是第三方成品，不是手写代码。
