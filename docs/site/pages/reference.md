---
slug: reference
title.en: API reference
title.zh: API 参考
summary.en: Choose the task-oriented Editor API or search the complete declaration-driven TypeScript reference.
summary.zh: 按任务使用编辑器 API，或搜索由类型声明生成的完整 TypeScript 参考。
---
:::en
## Choose the right API layer {#layers}

KJDraw publishes two reference layers:

- The [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) is the recommended application entry. It documents every `createKJDrawEditor()` option, property, method and event with JavaScript, React and Vue examples.
- The [complete TypeScript reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/) is generated from every public package export and type declaration. Use its search when building custom tools, headless workflows, plugins or file adapters.

Both references are generated during the documentation build. CI rejects stale Editor API names, missing package exports, broken deep links and search-index drift.

## Find an API by task {#tasks}

| Task | Start here |
| --- | --- |
| Mount a ready editor | `createKJDrawEditor()` in the Editor API |
| Open KJD or DXF | `KJDrawEditor.open()` |
| Save KJD or DXF | `KJDrawEditor.save()` |
| Execute, undo or redo an edit | `KJDrawEditor.execute()`, `undo()`, `redo()` |
| Control selection and view | `getSelection()`, `setSelection()`, `fit()`, `setTool()` |
| Build without the ready editor | `KJDrawSDK`, `KJDocument`, commands and transactions in the complete reference |
| Read or propose agent changes | Agent session and tool types in `@kanjieteam/kjdraw/agent` |
| Import or export formats | File-adapter exports and the **Files and projects** guide |
| Compile domain knowledge | Knowledge-pack and compiler types plus the **Knowledge packs** guide |

## Package entry points {#packages}

Use the root package for the ready editor and common SDK surface. Import narrower entry points only when the integration needs them:

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'
import { KJDraw } from '@kanjieteam/kjdraw/react'
import { createAgentSession } from '@kanjieteam/kjdraw/agent'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
```

The package `exports` map is authoritative. The complete reference lists only public symbols reachable through those entry points.
:::
:::zh
## 选择正确的 API 层 {#layers}

KJDraw 发布两层参考：

- [编辑器 API](https://kanjieteam.github.io/kjdraw/docs/latest/api/)是推荐的应用入口，包含 `createKJDrawEditor()` 的全部选项、属性、方法、事件，以及 JavaScript、React、Vue 示例。
- [完整 TypeScript 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/)由全部公开包导出与类型声明生成。构建自定义工具、无界面流程、插件或文件适配器时，可在这里搜索。

两层参考都会在文档构建期间生成。CI 会拒绝过期的编辑器 API 名称、缺失的包导出、失效深链接和搜索索引漂移。

## 按任务查找 API {#tasks}

| 任务 | 从这里开始 |
| --- | --- |
| 挂载完整编辑器 | 编辑器 API 中的 `createKJDrawEditor()` |
| 打开 KJD 或 DXF | `KJDrawEditor.open()` |
| 保存 KJD 或 DXF | `KJDrawEditor.save()` |
| 执行、撤销或重做修改 | `KJDrawEditor.execute()`、`undo()`、`redo()` |
| 控制选择与视图 | `getSelection()`、`setSelection()`、`fit()`、`setTool()` |
| 不使用完整编辑器进行构建 | 完整参考中的 `KJDrawSDK`、`KJDocument`、命令与事务 |
| 读取或提出 Agent 修改 | `@kanjieteam/kjdraw/agent` 的 Agent 会话与工具类型 |
| 导入或导出格式 | 文件适配器导出与**文件和工程**指南 |
| 编译领域知识 | 知识包/编译器类型与**知识包**指南 |

## 包入口 {#packages}

完整编辑器与常用 SDK 能力使用根包；只有接入确实需要时再导入更窄的入口：

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw'
import { KJDraw } from '@kanjieteam/kjdraw/react'
import { createAgentSession } from '@kanjieteam/kjdraw/agent'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
```

包的 `exports` 映射是权威边界；完整参考只列出可以通过这些入口访问的公开符号。
:::
