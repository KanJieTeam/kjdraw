---
slug: starters
title.en: Starter projects
title.zh: 起步工程
summary.en: Copy and run maintained Node, MCP, Vanilla, React and Vue consumers of the public package.
summary.zh: 复制并运行基于公开包的 Node、MCP、原生、React 与 Vue 起步工程。
---
:::en
## Choose a starter {#choose}

Every starter is a small independent project under [`examples/starters`](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters). They use the same public package entries documented by the API reference and are compiled or executed by the repository test suite.

| Project | Result | First command |
| --- | --- | --- |
| [Node + TypeScript](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/node-typescript) | Writes and reopens editable KJD and DXF | `npm run start` |
| [MCP stdio client](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/mcp-client) | Produces a host-bounded review candidate | `npm run start` |
| [Vanilla browser](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/vanilla-browser) | Mounts the complete editor with Vite | `npm run dev` |
| [React browser](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/react-browser) | Mounts the supported React component | `npm run dev` |
| [Vue browser](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/vue-browser) | Mounts the supported Vue component | `npm run dev` |

Copy one directory, run `npm install`, then run the listed command. Node.js 22 or newer is required. Pin an exact KJDraw version instead of `next` when your application needs reproducible builds.

## Expected results {#expected-results}

The Node starter prints a JSON receipt and writes `circle.kjd` plus `circle.dxf`. The MCP starter writes a new KJD/DXF/SVG/HTML candidate set under its host-selected workspace without changing the source drawing. Each browser starter shows the complete editor and a button or startup action that creates a native 5 mm-radius circle.

These are runnable integration projects, not screenshots. The automated consumer regression bundles all three browser entries, reopens both Node outputs, and performs the MCP initialize–list–call exchange against the packaged server.

## Troubleshoot {#troubleshoot}

- **A blank browser page:** give the editor host a non-zero height and inspect the browser console.
- **Package resolution fails:** remove the starter's `node_modules`, confirm Node.js 22+, and run `npm install` again.
- **MCP exits before initialization:** run the package's `kjdraw-mcp --check-tool-schemas`, then verify every configured path is absolute or inside the selected workspace as required by the MCP guide.
- **A drawing does not reopen:** retain the generated file and complete terminal error; do not replace it with a screenshot.

Continue with the [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/), [complete TypeScript reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/), or [MCP integration](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/).
:::
:::zh
## 选择起步工程 {#choose}

每个起步工程都是 [`examples/starters`](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters) 下的独立小项目。它们只使用 API 参考中公开的包入口，并由仓库测试实际编译或执行。

| 工程 | 运行结果 | 首条命令 |
| --- | --- | --- |
| [Node + TypeScript](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/node-typescript) | 写出并重开可编辑 KJD 与 DXF | `npm run start` |
| [MCP stdio 客户端](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/mcp-client) | 生成受宿主边界约束的审核候选 | `npm run start` |
| [原生浏览器](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/vanilla-browser) | 使用 Vite 挂载完整编辑器 | `npm run dev` |
| [React 浏览器](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/react-browser) | 挂载受支持的 React 组件 | `npm run dev` |
| [Vue 浏览器](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/vue-browser) | 挂载受支持的 Vue 组件 | `npm run dev` |

复制一个目录，运行 `npm install`，再运行表中的命令。需要 Node.js 22 或更新版本。应用需要可复现构建时，应把 `next` 换成确切的 KJDraw 版本。

## 预期结果 {#expected-results}

Node 工程会打印 JSON 回执，并写出 `circle.kjd` 与 `circle.dxf`。MCP 工程会在宿主选择的工作区中创建新的 KJD/DXF/SVG/HTML 候选文件组，不修改源图。三个浏览器工程都会显示完整编辑器，并通过按钮或启动动作创建一个原生的半径 5 毫米圆。

这些是可运行的集成工程，不是截图。自动化消费者回归会打包三个浏览器入口、重开 Node 生成的两种文件，并针对打包的 MCP 服务执行初始化—列工具—调用工具协议交换。

## 故障排查 {#troubleshoot}

- **浏览器空白：**确认编辑器宿主具有非零高度，并检查浏览器控制台；
- **无法解析包：**删除该工程的 `node_modules`，确认 Node.js 22+，再重新运行 `npm install`；
- **MCP 在初始化前退出：**先运行包内的 `kjdraw-mcp --check-tool-schemas`，再按 MCP 指南核对绝对路径和工作区内路径；
- **图纸无法重开：**保留生成文件和完整终端错误，不要只提供截图。

随后可阅读 [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)、[完整 TypeScript 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/)或 [MCP 集成](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/)。
:::
