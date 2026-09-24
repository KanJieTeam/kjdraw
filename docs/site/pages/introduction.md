---
slug: introduction
title.en: KJDraw
title.zh: KJDraw
summary.en: Build editable engineering CAD experiences in the browser, in your application, or with an AI agent.
summary.zh: 在浏览器、自己的应用或 AI 智能体中构建可编辑的工程 CAD 体验。
---
:::en
## Engineering CAD, ready to extend {#what-it-is}

KJDraw combines an embeddable drawing workbench, a TypeScript SDK, and reviewable agent actions. Open an engineering drawing, edit its actual objects, save it, and reopen the result. The browser UI and headless workflows use the same document and command model.

- **Edit in the browser.** Mount a workbench with drawing tools, layers, properties, file actions, and undo and redo.
- **Build with an SDK.** Work with documents, typed commands, events, and KJD or DXF files from JavaScript or TypeScript.
- **Connect an agent.** Prepare proposed drawing changes, inspect the candidate, and keep a record of what was executed.

## Explore real drawings {#what-you-can-do}

The [Showcase](https://kanjieteam.github.io/kjdraw/docs/latest/showcase/) contains editable public drawings and focused CAD capability examples. Open a sample in the [Playground](https://kanjieteam.github.io/kjdraw/), inspect its objects and layers, then follow the source used to build it. These examples also participate in development regression checks.

Public examples cover mechanical, borehole and section drawings, architecture, site plans and roads, plus geometry, dimensions, fonts, blocks, import and editing history. The [capability reference](https://kanjieteam.github.io/kjdraw/docs/latest/capabilities/) states the supported boundaries for each area.

## Start with a working editor {#starting-point}

Install the release candidate package and mount the editor in an element with an explicit height:

```sh
npm install @kanjieteam/kjdraw@next
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'

const editor = createKJDrawEditor('#cad', { document: 'sample' })
await editor.ready
editor.fit()
```

The [five-minute quickstart](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) includes a complete Vite project, a drawing command, and a save and reopen check.

## One document, several workflows {#runtime}

Use the same editable `KJDocument` in the workbench and SDK. Commands preserve object identity, group changes into transactions, and support undo and redo. KJD saves the native document; DXF exchanges drawing entities with other CAD tools. Agent proposals create a candidate for review.

Read [core concepts](https://kanjieteam.github.io/kjdraw/docs/latest/concepts/) for documents and revisions, [commands](https://kanjieteam.github.io/kjdraw/docs/latest/commands/) for changes, and [files](https://kanjieteam.github.io/kjdraw/docs/latest/files/) for import and export behavior.

## Choose your integration {#integrations}

The maintained starter projects cover [vanilla browser, React, Vue, Node TypeScript, and an MCP client](https://kanjieteam.github.io/kjdraw/docs/latest/starters/). Each has source code and a command you can run locally. The [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) answers common integration tasks; the [TypeScript reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/) lists public package exports.

## Build your drawing workflow {#next-step}

Start with the [quickstart](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/), inspect an editable [example](https://kanjieteam.github.io/kjdraw/docs/latest/showcase/), or browse the [API](https://kanjieteam.github.io/kjdraw/docs/latest/api/). Contributions and issue reports are welcome on [GitHub](https://github.com/KanJieTeam/kjdraw).
:::
:::zh
## 可扩展的工程 CAD {#what-it-is}

KJDraw 将可嵌入的绘图工作台、TypeScript SDK 和可审核的智能体操作放在同一套图档模型上。打开工程图纸，编辑真实对象，保存后重新打开；浏览器界面和无界面流程使用相同的图档与命令机制。

- **在浏览器中编辑。** 挂载带绘图工具、图层、属性、文件操作及撤销重做的工作台。
- **通过 SDK 构建。** 在 JavaScript 或 TypeScript 中操作图档、类型化命令、事件以及 KJD、DXF 文件。
- **连接智能体。** 生成候选修改，检查结果，并保留实际执行的回执。

## 浏览真实图纸 {#what-you-can-do}

[案例库](https://kanjieteam.github.io/kjdraw/docs/latest/showcase/)包含可编辑的公开图纸和聚焦 CAD 能力的示例。可以在 [Playground](https://kanjieteam.github.io/kjdraw/) 打开样例，检查对象和图层，再追溯生成源码。这些示例也参与开发回归。

目前公开示例涵盖机械、钻孔柱状与剖面、建筑、总平、道路，以及几何、标注、字体、块、导入和编辑历史。[能力参考](https://kanjieteam.github.io/kjdraw/docs/latest/capabilities/)列明各项支持边界。

## 运行第一个编辑器 {#starting-point}

安装候选版，并将编辑器挂载到明确设定高度的容器：

```sh
npm install @kanjieteam/kjdraw@next
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'

const editor = createKJDrawEditor('#cad', { document: 'sample' })
await editor.ready
editor.fit()
```

[五分钟快速上手](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/)给出完整 Vite 工程、绘图命令，以及保存重开检查。

## 一份图档，贯穿多种流程 {#runtime}

工作台与 SDK 操作同一份可编辑的 `KJDocument`。命令维持对象身份，将修改组合为事务，并支持撤销重做。KJD 保存原生图档，DXF 用于与其他 CAD 工具交换图元。智能体提案会生成可检查的候选结果。

阅读[核心概念](https://kanjieteam.github.io/kjdraw/docs/latest/concepts/)了解图档与修订，[命令](https://kanjieteam.github.io/kjdraw/docs/latest/commands/)了解修改方式，[文件](https://kanjieteam.github.io/kjdraw/docs/latest/files/)了解导入导出行为。

## 选择接入方式 {#integrations}

维护中的示例工程包括[原生浏览器、React、Vue、Node TypeScript 和 MCP 客户端](https://kanjieteam.github.io/kjdraw/docs/latest/starters/)，每个都有可本地运行的源码和命令。[Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)按常见任务查找；[完整 TypeScript 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/)列出公开包入口。

## 开始构建你的绘图流程 {#next-step}

从[快速上手](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/)开始，打开一份可编辑的[案例](https://kanjieteam.github.io/kjdraw/docs/latest/showcase/)，或查询 [API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)。欢迎在 [GitHub](https://github.com/KanJieTeam/kjdraw) 参与改进与反馈。
:::
