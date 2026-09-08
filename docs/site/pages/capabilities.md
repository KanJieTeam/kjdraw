---
slug: capabilities
title.en: Capabilities
title.zh: 功能能力
summary.en: Explore the editor, drawing, file, automation and extension features available to KJDraw applications.
summary.zh: 了解 KJDraw 应用可使用的编辑器、图档、文件、自动化与扩展能力。
---
:::en
## Complete editor experience {#editor-experience}

`createKJDrawEditor()` mounts a CAD workspace with a canvas, ribbon tools, command line, layers, properties, selection, zoom and file actions. It can start with a sample, a blank drawing or an existing `KJDocument`.

| Task | Available API |
| --- | --- |
| Embed in JavaScript or TypeScript | `createKJDrawEditor()` |
| Use React | `<KJDraw>` from `@kanjieteam/kjdraw/react` |
| Use Vue | `<KJDraw>` from `@kanjieteam/kjdraw/vue` |
| Open and save drawings | `editor.open()` and `editor.save()` |
| Control the editor | `fit()`, `setSelection()`, `setTool()` and `setOptions()` |
| Respond to users | `change`, `selectionchange`, `documentchange` and `error` events |

## Drawing and editing {#drawing-and-editing}

- Create and edit common 2D entities including lines, polylines, circles, arcs, ellipses, splines, text, hatches, dimensions and blocks.
- Move, rotate, scale, mirror, offset, trim, extend, break, fillet, chamfer and explode through commands.
- Work with layers, layouts, selection sets, grips, snapping, intersections and measured geometry.
- Group related changes into transactions with undo and redo.
- Use the portable geometry path everywhere, with optional Rust/WebAssembly document, geometry and solid modules for supported workloads.
- Start from editable site-plan, architectural, road-profile and mechanical examples.

## Files and projects {#files-and-projects}

KJD stores an individual drawing, KJP packages multi-drawing projects and related assets, and DXF connects the editor to common CAD exchange workflows. Applications can use browser file pickers, return bytes for custom storage, or connect project providers.

Continue to the **Files and projects** guide for working examples and format-specific details.

## Automation and extensions {#automation-and-extensions}

The same commands used by the editor are available to application code, plugins and approved AI workflows. Add custom commands and panels through plugins, use the headless core for batch processing, or register project, compute and scene providers for your deployment.

Use `sdk.capabilities()` when an application needs to inspect the commands, entities and file adapters registered in its current runtime.

## Compatibility details {#compatibility-details}

For format-specific coverage and reproducible issue reporting, use the maintained [compatibility matrix](https://github.com/KanJieTeam/kjdraw/blob/main/docs/capability-matrix.md) and [current status](https://github.com/KanJieTeam/kjdraw/blob/main/docs/status.md). Never attach private customer drawings to a public issue; use a minimal redistributable example.
:::
:::zh
## 完整编辑器体验 {#editor-experience}

`createKJDrawEditor()` 会挂载包含画布、Ribbon 工具、命令行、图层、属性、选择、缩放与文件操作的 CAD 工作区。它可以从示例、空白图档或现有 `KJDocument` 开始。

| 任务 | 可用 API |
| --- | --- |
| 嵌入 JavaScript 或 TypeScript | `createKJDrawEditor()` |
| 使用 React | `@kanjieteam/kjdraw/react` 的 `<KJDraw>` |
| 使用 Vue | `@kanjieteam/kjdraw/vue` 的 `<KJDraw>` |
| 打开和保存图档 | `editor.open()` 与 `editor.save()` |
| 控制编辑器 | `fit()`、`setSelection()`、`setTool()` 与 `setOptions()` |
| 响应用户操作 | `change`、`selectionchange`、`documentchange` 与 `error` 事件 |

## 图档与编辑 {#drawing-and-editing}

- 创建和编辑直线、多段线、圆、圆弧、椭圆、样条曲线、文字、填充、标注与块等常用二维实体。
- 通过命令完成移动、旋转、缩放、镜像、偏移、修剪、延伸、打断、圆角、倒角与分解。
- 使用图层、布局、选择集、夹点、捕捉、交点与几何测量。
- 将相关修改组成事务，并支持撤销和重做。
- 默认使用可移植几何能力，并可为适合的任务启用 Rust/WebAssembly 图档、几何与实体模块。
- 从可编辑的场地总图、建筑平面、道路纵断面与机械制造图开始。

## 文件与工程 {#files-and-projects}

KJD 保存单张图档，KJP 打包多图档工程及相关资源，DXF 用于连接常见 CAD 交换流程。应用可以使用浏览器文件选择器、取得字节后接入自有存储，也可以连接工程 Provider。

继续阅读**文件与工程**指南，查看可运行示例和各格式说明。

## 自动化与扩展 {#automation-and-extensions}

编辑器使用的同一套命令也可供应用代码、插件和经批准的 AI 流程调用。可通过插件增加自定义命令与面板，使用无界面核心进行批处理，或为部署环境注册工程、计算与场景 Provider。

当应用需要了解当前运行时已注册的命令、实体与文件适配器时，可以调用 `sdk.capabilities()`。

## 兼容性说明 {#compatibility-details}

各格式的具体覆盖范围与问题复现要求，见持续维护的[兼容矩阵](https://github.com/KanJieTeam/kjdraw/blob/main/docs/capability-matrix.md)和[当前状态](https://github.com/KanJieTeam/kjdraw/blob/main/docs/status.md)。请勿在公开 issue 中附加客户私有图纸，应改用可再分发的最小示例。
:::
