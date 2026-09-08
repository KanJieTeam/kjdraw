<p align="center"><img src="docs/assets/mark.svg" alt="KJDraw" width="88" height="88"></p>

<h1 align="center">KJDraw</h1>

<p align="center"><strong>用一个 TypeScript 包，在浏览器中打开、检查、编辑和自动化工程图纸。</strong></p>

<p align="center">面向工程应用、交互式 CAD 工作台与可审核 AI Agent 的可扩展基础。</p>

<p align="center">
  <a href="https://github.com/KanJieTeam/kjdraw/releases"><img src="https://img.shields.io/github/v/release/KanJieTeam/kjdraw?include_prereleases&style=flat-square&labelColor=30363d&color=2863f0" alt="GitHub Release"></a>
  <a href="https://www.npmjs.com/package/@kanjieteam/kjdraw"><img src="https://img.shields.io/npm/v/@kanjieteam/kjdraw/next?style=flat-square&label=npm_next&labelColor=30363d&color=2863f0" alt="npm 候选版渠道"></a>
  <a href="https://kanjieteam.github.io/kjdraw/"><img src="https://img.shields.io/badge/▲_在线_Demo-打开-2863f0?style=flat-square&labelColor=30363d" alt="在线 Demo"></a>
  <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><img src="https://img.shields.io/badge/▣_开发文档-latest-2863f0?style=flat-square&labelColor=30363d" alt="开发文档"></a>
  <a href="https://github.com/KanJieTeam/kjdraw"><img src="https://img.shields.io/badge/GitHub-源码-181717?style=flat-square&logo=github" alt="GitHub 源码"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d" alt="Apache 2.0"></a>
</p>

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><img src="docs/media/kjdraw-workflow-zh.gif" alt="KJDraw 浏览行业图纸、审核 Agent 修改，再从空白绘制安装板、阵列螺栓孔并添加尺寸标注" width="100%"></a></p>

<p align="center"><sub>真实工作台录制：浏览行业图纸、审核 Agent 修改，再从空白绘制零件、阵列并标注尺寸。</sub></p>

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><strong>打开在线工作台</strong></a> · <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><strong>快速开始</strong></a> · <a href="https://kanjieteam.github.io/kjdraw/docs/latest/api/"><strong>API 参考</strong></a> · <a href="README.md">English</a></p>

直接打开场地总图、建筑平面、道路纵断面和机械详图：切换图纸、检查图层、修改几何并保存成果。能源园区示例还提供交互式 Agent 修改审核流程。体验工作台无需注册或上传图纸。

也可以从空白图纸开始：构造圆、圆弧、椭圆、多边形和样条，输入精确坐标，使用矩形或环形阵列复制零件，再添加填充与尺寸标注。[工作台操作指南](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/)提供工具参数、取点顺序、键盘输入和保存步骤。

## 可以用它构建什么

| 构建目标 | 从哪里开始 | 直接获得的能力 |
| --- | --- | --- |
| **可嵌入 CAD 查看与编辑器** | [`@kanjieteam/kjdraw/editor`](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) | 一次挂载中英文绘图界面，包含 Ribbon、图层、特性、命令行与本地文件操作 |
| **专业工程应用** | [`@kanjieteam/kjdraw`](https://kanjieteam.github.io/kjdraw/docs/latest/architecture/) | 在强类型文档、命令与事务核心上组合自己的业务界面和领域工作流 |
| **文件与自动化流水线** | [文件指南](https://kanjieteam.github.io/kjdraw/docs/latest/files/) + CLI | 在浏览器或 Node.js 中读取、校验、转换和写入 KJD、KJP 与已发布 DXF 范围 |
| **可审核 CAD Copilot** | [Agent 指南](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) | 把意图编译为精确命令，展示可视差异，人工批准后返回可验证回执 |
| **CAD 扩展生态** | [插件指南](https://kanjieteam.github.io/kjdraw/docs/latest/plugins/) | 扩展命令、实体、渲染器、文件适配器、工具、捕捉、属性和工作区面板 |

KJDraw 源于 **勘界 Kanjie** 的真实产品研发。开放核心保持通用，可复用的能力持续回到这个仓库，让开源项目与勘界产品共享同一套 CAD 基础，而不是重复建设。

## 同一张图纸，多种构建方式

人工工具、插件和 AI Agent 都通过同一组强类型命令工作。每次被接受的操作都会形成一个普通图档修订，进入撤销/重做和工程历史；Agent 因此是 CAD 应用的一名参与者，而不是绕过应用的旁路。

```text
人工工具 ─┐
插件 ─────┼─→ 强类型命令 → 预览 → 原子事务 → 图档修订 → KJD / KJP / DXF
AI Agent ─┘                       │
                                 └─→ 回执 → 验证 → 撤销
```

按产品需要设计界面，让应用、插件和 Agent 共享图纸数据、编辑命令与撤销历史。

## 60 秒开始

安装当前候选版渠道：

```sh
npm install @kanjieteam/kjdraw@next
```

布局切换与交互移动需要 **1.0.0-rc.3 或更新版本**，可用 `npm list @kanjieteam/kjdraw` 核对安装结果。候选版使用 `next`；不带版本标签的包仍跟随旧的 `latest` 渠道。

一次挂载编辑器：

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const editor = createKJDrawEditor(
  '#cad',
  {
    document: 'sample',
    locale: 'zh-CN',
    theme: 'dark',
    layout: 'classic', // 'classic' | 'compact' | 'focus'（RC3+）
  },
)

await editor.ready
// await editor.open(file) // 来自文件选择框的 File
// await editor.save({ format: 'DXF', download: true })
```

```html
<div id="cad" style="height: 720px"></div>
```

也可以只使用无界面 SDK，完全自行设计界面：

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw/core'

const cad = createKJDrawSDK()
const drawing = cad.createDocument({
  documentId: 'site-plan',
  units: 'millimeter',
})

const line = await cad.executeCommand('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 40, 0] },
})

await cad.executeCommand('MOVE', { id: line.id, dx: 25, dy: 10 })
console.log(drawing.revision, drawing.fingerprint())
```

### Vanilla、React 与 Vue

直接使用组件接入应用，由组件管理创建和释放。切换界面设置不会重新创建用户正在编辑的图纸。

**React**

```tsx
import { KJDraw } from '@kanjieteam/kjdraw/react'

export default function DrawingPage() {
  return <KJDraw document="sample" locale="zh-CN" style={{ height: 720 }} />
}
```

**Vue**

```vue
<script setup lang="ts">
import { KJDraw } from '@kanjieteam/kjdraw/vue'
</script>

<template>
  <KJDraw document="sample" locale="zh-CN" style="height: 720px" />
</template>
```

| 技术栈 | 开发指南 | 可运行源码 |
| --- | --- | --- |
| **Vanilla TypeScript** | [快速开始](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) | [`vanilla-workbench.ts`](packages/kjdraw-sdk/examples/vanilla-workbench.ts) |
| **React** | [React 集成](https://kanjieteam.github.io/kjdraw/docs/latest/react/) | [`react.tsx`](packages/kjdraw-sdk/examples/react.tsx) |
| **Vue** | [Vue 集成](https://kanjieteam.github.io/kjdraw/docs/latest/vue/) | [`vue.ts`](packages/kjdraw-sdk/examples/vue.ts) |
| **插件** | [插件系统](https://kanjieteam.github.io/kjdraw/docs/latest/plugins/) | [`plugin-starter`](examples/plugin-starter/README.md) |

### 从行业图纸开始

Demo 的原创行业图纸也可以在自己的应用中直接使用：

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw/core'
import { createIndustrySample } from '@kanjieteam/kjdraw/samples'
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const sdk = createKJDrawSDK()
const drawing = await createIndustrySample(sdk, 'sample-architecture')
const editor = createKJDrawEditor('#cad', { sdk, document: drawing })
await editor.ready
```

可选场地总图 `sample-site-plan`、建筑平面 `sample-architecture`、道路纵断面 `sample-road-profile`、机械详图 `sample-mechanical`。所有样例均可编辑，不含客户数据，不作为施工图使用。

## 文件、工程与 CLI

| 格式 | 在 KJDraw 中的作用 |
| --- | --- |
| **KJD** | 可校验、带稳定 ID 和修订的规范事务图档 |
| **KJP** | 包含清单、哈希、快照与命令日志的确定性多图纸工程 |
| **DXF** | 有文档、语料和独立跨工具审计支撑的 ASCII 兼容范围 |

已安装的包也可以直接用于终端：

```sh
npx kjdraw inspect drawing.dxf
npx kjdraw validate project.kjp
npx kjdraw convert drawing.kjd drawing.dxf --dxf-version 2018
```

继续阅读[文件读写指南](https://kanjieteam.github.io/kjdraw/docs/latest/files/)、[DXF 兼容证据](docs/dxf-compatibility.md)和[已知边界](docs/status.md)。

## 看得见、可撤销的 Agent 修改

KJDraw 会把已经审核的 Agent 计划绑定到精确命令参数、图档身份、内容摘要、指纹、预期修订、有效期与审核者。被批准的计划只执行一次，产生回执，并进入普通撤销/重做历史。

```text
意图 → 不可变提案 → 可视差异 → 人工批准
     → 一次原子命令 → 回执 → 保存 / 重开 / 撤销
```

从 [Agent 工作流指南](https://kanjieteam.github.io/kjdraw/docs/latest/agent/)开始，也可以把 [`docs/agent.md`](docs/agent.md) 接入说明交给编程 Agent，或运行 [`examples/agent-command.mjs`](examples/agent-command.mjs)。

## 为持续扩展而设计

| 模块 | 扩展能力 |
| --- | --- |
| **文档** | 实体、表、块、模型/图纸空间、资源、稳定句柄和修订 |
| **编辑** | 撤销/重做、窗口/交叉/围栏选择、夹点拖动、图层保护与强类型二维命令 |
| **渲染** | 参考 Canvas 渲染器，以及可替换的场景 Provider 与渲染器边界 |
| **工作台** | 只依赖公共包出口、可直接挂载的中英文 CAD 界面 |
| **插件** | 版本化清单、显式权限、激活和完整释放 |
| **内核** | 可重建的 Rust/WASM 文档处理与几何计算 |
| **部署** | 通过显式 Provider 支持浏览器、桌面、私有化、云增强与混合架构 |

npm 包采用 ESM，运行时零依赖。扩展核心边界前，请先阅读[架构指南](https://kanjieteam.github.io/kjdraw/docs/latest/architecture/)。

## 工作台快捷键

| 输入 | 操作 |
| --- | --- |
| `V` / `L` / `P` / `C` / `A` | 选择 / 直线 / 多段线 / 圆 / 圆弧 |
| `R` / `E` / `T` / `D` | 矩形 / 椭圆 / 文字 / 测距 |
| 鼠标滚轮 / 中键拖动 | 缩放 / 平移 |
| 从空白处向右 / 向左拖动 | 全包含框选 / 交叉选择 |
| 选择时按 `Shift` / `Ctrl` 或 `⌘` | 追加 / 移除对象 |
| `Ctrl` 或 `⌘` + `A` | 全选当前绘图空间内可编辑对象 |
| 命令行输入 `FENCE` | 指定开放围栏；Enter 完成，Backspace 撤回一点 |
| `Ctrl` 或 `⌘` + `Z` | 撤销；再加 `Shift` 重做 |
| `Ctrl` 或 `⌘` + `Enter` | 预览当前 Agent 场景 |
| `Esc` | 回到选择并清除当前预览 |

## 走向 1.0

通过 [RC3 更新说明](docs/releases/1.0.0-rc.3.md)了解交互与布局变化，在[路线图](docs/roadmap.md)中查看后续方向。[工作台操作指南](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/)带你完成绘图、框选、夹点编辑、尺寸标注和保存。

## 开发与贡献

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run test:browser
```

运行 `npm run dev` 后访问 **http://localhost:4173**。高价值贡献包括可复现 DXF 案例、几何与渲染修复、框架集成、插件、无障碍、性能和文档。

请阅读[贡献指南](CONTRIBUTING.md)、[治理规则](GOVERNANCE.md)、[支持政策](SUPPORT.md)与[路线图](docs/roadmap.md)。

**由 [KanJieTeam](https://github.com/KanJieTeam) 维护** · [kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0
