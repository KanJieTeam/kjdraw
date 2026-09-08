---
slug: introduction
title.en: Introduction
title.zh: 简介
summary.en: KJDraw is a programmable CAD foundation for engineering applications, browser workbenches and reviewable AI-agent changes.
summary.zh: KJDraw 是面向工程应用、浏览器工作台与可审核 AI Agent 修改的可编程 CAD 基础设施。
---
:::en
## What KJDraw is {#what-it-is}

KJDraw gives web applications a complete embeddable CAD editor and a TypeScript SDK for building specialized drawing experiences. One `createKJDrawEditor()` call mounts the canvas, tools, layers, properties and file actions. React and Vue components provide the same editor with framework-native lifecycles.

Use it to display and edit engineering drawings, open or export KJD and DXF files, add product-specific tools, automate repeatable changes, or let an AI assistant prepare changes for a person to review.

## Choose your starting point {#starting-point}

| What you are building | Start with | You get |
| --- | --- | --- |
| JavaScript or TypeScript app | `createKJDrawEditor()` | A ready-to-use editor and a small imperative API |
| React app | `@kanjieteam/kjdraw/react` | `<KJDraw>` plus a typed editor ref |
| Vue app | `@kanjieteam/kjdraw/vue` | `<KJDraw>` plus exposed editor methods |
| Custom CAD interface | `@kanjieteam/kjdraw/core` | Documents, commands, files and your own UI |
| AI-assisted workflow | `@kanjieteam/kjdraw/agent` | Reviewable plans, approval and execution receipts |

## What you can do {#what-you-can-do}

- Start with a sample drawing or an empty canvas, then zoom, select, draw and inspect objects.
- Open and save KJD or DXF, manage projects, and integrate your own storage flow.
- Execute typed commands with undo and redo, or subscribe to document and selection changes.
- Switch English or Chinese UI, light or dark appearance, and classic, compact or canvas-first focus layouts at runtime.
- Add plugins, custom commands, renderers and AI-assisted workflows as your product grows.

Start with **Quickstart**, then keep the task-oriented [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) beside your code. The [complete TypeScript reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/) covers every public package entry.
:::
:::zh
## KJDraw 是什么 {#what-it-is}

KJDraw 为 Web 应用提供可直接嵌入的完整 CAD 编辑器，以及用于构建专业绘图体验的 TypeScript SDK。一次调用 `createKJDrawEditor()` 就能挂载画布、工具、图层、属性与文件操作；React 和 Vue 组件用各自框架熟悉的生命周期提供同一编辑器。

你可以用它显示和编辑工程图纸、打开或导出 KJD 与 DXF、增加产品专用工具、自动完成重复修改，或让 AI 助手先准备修改，再由人员确认执行。

## 选择接入方式 {#starting-point}

| 你要构建的产品 | 从这里开始 | 直接获得 |
| --- | --- | --- |
| JavaScript 或 TypeScript 应用 | `createKJDrawEditor()` | 可直接使用的编辑器与简洁控制 API |
| React 应用 | `@kanjieteam/kjdraw/react` | `<KJDraw>` 与类型化编辑器 ref |
| Vue 应用 | `@kanjieteam/kjdraw/vue` | `<KJDraw>` 与暴露的编辑器方法 |
| 自定义 CAD 界面 | `@kanjieteam/kjdraw/core` | 图档、命令、文件能力与自定义 UI |
| AI 辅助流程 | `@kanjieteam/kjdraw/agent` | 可审核计划、批准与执行回执 |

## 现在可以完成什么 {#what-you-can-do}

- 从示例图纸或空白画布开始，完成缩放、选择、绘制与对象检查。
- 打开和保存 KJD 或 DXF，管理工程，并接入自己的存储流程。
- 执行类型化命令并撤销、重做，或监听图档与选择变化。
- 运行时切换中英文、明暗外观，以及经典、紧凑或画布优先的专注布局。
- 随产品成长继续增加插件、自定义命令、渲染器与 AI 辅助流程。

先阅读**快速上手**，开发时可随时查看按任务组织的 [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)。[完整 TypeScript 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/)覆盖全部公开包入口。
:::
