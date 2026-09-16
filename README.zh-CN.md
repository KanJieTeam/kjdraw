<p align="center"><img src="docs/assets/mark.svg" alt="KJDraw" width="80" height="80"></p>

<h1 align="center">KJDraw</h1>

<p align="center"><strong>给 AI 装上真正的 CAD 能力。</strong></p>

<p align="center">模型只需表达工程意图，KJDraw 负责把它编译为<br>可编辑、可验证、可撤销、可保存重开的真实 CAD 图纸。</p>

<p align="center">
  <a href="#快速开始"><strong>快速开始</strong></a> ·
  <a href="https://kanjieteam.github.io/kjdraw/ai/"><strong>开始 AI 绘图</strong></a> ·
  <a href="https://kanjieteam.github.io/kjdraw/"><strong>在线编辑器</strong></a> ·
  <a href="#接入你的应用"><strong>接入你的应用</strong></a> ·
  <a href="#给你的-agent-配上-cad-工具"><strong>构建 CAD Agent</strong></a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/KanJieTeam/kjdraw/releases"><img src="https://img.shields.io/github/v/release/KanJieTeam/kjdraw?include_prereleases&style=flat-square&labelColor=30363d&color=2863f0" alt="GitHub 候选版本"></a>
  <a href="https://www.npmjs.com/package/@kanjieteam/kjdraw"><img src="https://img.shields.io/npm/v/@kanjieteam/kjdraw/next?style=flat-square&label=npm_next&labelColor=30363d&color=2863f0" alt="npm 候选版渠道"></a>
  <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><img src="https://img.shields.io/badge/Docs-get_started-2863f0?style=flat-square&labelColor=30363d" alt="使用文档"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d" alt="Apache 2.0"></a>
</p>

## 为什么是 KJDraw：生成几何只是开始

生成几何图形并不难，难的是把它变成一张经得起工程使用的 CAD 图纸：图纸里有数百个相互关联的对象，模型要能在不同视图和多轮修改中准确找到同一个对象，保持尺寸、图层、块、填充、引用及其关系，并确保撤销、导出、保存、重新打开后结果一致。让 LLM 逐个输出坐标和基础实体，会让 token 随图纸规模膨胀，也容易让几何和工程约束逐轮偏移，导致后续修改只能猜对象；即使渲染结果看起来正确，也无法证明图纸仍然可编辑、可审计。KJDraw 将模型与 CAD 执行分开：模型只表达绘图意图、工程事实和约束，KJDraw 在本地用确定性引擎完成对象定位、几何生成、图层与引用维护、事务执行、校验以及保存重开，让不同模型都能调用同一套可靠的 CAD 能力。

## KJDraw 真正解决什么

| 原则 | KJDraw 的做法 |
| --- | --- |
| **模型只表达意图** | 模型通过少量高层工具提供需求、约束和修改，不逐个堆砌基础图元。 |
| **引擎确定性执行** | KJDraw 解析几何、对象身份、图层、引用和单事务执行；缺少关键数据就拒绝。 |
| **图纸始终可编辑** | 结果是结构化 CAD，不是截图；支持继续修改、撤销重做、DXF/KJD/KJP 保存和重新打开。 |

| 核心能力 | 现在能做什么 |
| --- | --- |
| **读懂现有图纸** | 分页读取、空间/属性查询、稳定对象 ID、图层、块引用、拓扑和修改影响分析。 |
| **高层工程成图** | 机械加工图、建筑平面图、场地与管线图、道路平纵横、柱状图、地质剖面图、折线图和柱状图。 |
| **精确多轮改图** | 定位对象后移动、复制、旋转、缩放、偏移、拉伸、延长、改文字、换图层，以及删除后关系重建。 |
| **确定性质量闭环** | 每次执行检查几何、图层、引用和版本；一个修改对应一个可撤销事务，并可保存、重开、再验证。 |
| **接入不同智能体** | Kimi Code、WorkBuddy、ZCode 与 TraeCode 共享同一套 MCP CAD 工具；模型 Key 留在客户端。 |
| **嵌入你的产品** | 同一引擎提供 TypeScript/JavaScript SDK、React、Vue、完整编辑器、CLI、MCP 与本地文件工作流。 |

## 快速开始

### 在 AI 智能体中使用 KJDraw

在任意目录运行一次即可。安装器会把 KJDraw 接入当前用户的 Kimi Code、WorkBuddy 与 ZCode，之后可在任意工作区使用；TraeCode 会打开官方的一次性导入确认。模型 API Key 始终留在你的 AI 客户端，不交给 KJDraw。

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

连接器会安全合并用户级配置，不再要求修改每个项目；可编辑图纸宿主统一保存在用户主目录。[安装细节与安全边界](docs/try-in-ai.zh-CN.md)

> **1.0 候选状态：** 命令行配置与真实引擎冒烟测试已经通过；四个客户端 GUI 与真实模型的独立验收仍是发布门槛。KJDraw 不收集模型 Key；安装器会把新建请求物化为独立验证的 KJD、DXF 和 SVG 候选图，永不覆盖源图；原位修改与破坏性操作仍由宿主审核。

### 体验在线编辑器

[打开在线编辑器](https://kanjieteam.github.io/kjdraw/)，无需注册或上传文件。可体验机械、建筑、场地和道路样例，检查图层、执行修改、撤销、保存并重新打开。样例仅用于产品体验，不作为施工图使用。详见[工作台操作指南](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/)。

## 接入你的应用

安装候选版：

```sh
npm install @kanjieteam/kjdraw@next
```

以下示例需要 **1.0.0-rc.3 或更新版本**。请使用 `next` 渠道，`latest` 可能较旧。已发布版本及尚未发布到 npm 的源码更新，详见[版本状态](docs/status.md)。

### JavaScript / TypeScript

准备一个有高度的容器：

```html
<div id="cad" style="height: 720px"></div>
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'zh-CN',
  theme: 'dark',
  layout: 'classic',
})

await editor.ready
// await editor.open(file) // 来自文件选择框的 File
// await editor.save({ format: 'DXF', download: true })
```

### React

在已有的 React 应用中使用：

```tsx
import { KJDraw } from '@kanjieteam/kjdraw/react'

export default function DrawingPage() {
  return <KJDraw document="sample" locale="zh-CN" style={{ height: 720 }} />
}
```

### Vue

在已有的 Vue 3 应用中使用：

```vue
<script setup lang="ts">
import { KJDraw } from '@kanjieteam/kjdraw/vue'
</script>

<template>
  <KJDraw document="sample" locale="zh-CN" style="height: 720px" />
</template>
```

按需要选择**经典、紧凑或专注布局**。切换布局保留当前图纸和撤销记录。

[快速开始](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) · [React 指南](https://kanjieteam.github.io/kjdraw/docs/latest/react/) · [Vue 指南](https://kanjieteam.github.io/kjdraw/docs/latest/vue/) · [可运行示例](packages/kjdraw-sdk/examples)

## 给你的 Agent 配上 CAD 工具

你的应用负责接入 AI 模型，KJDraw 提供 CAD 工具。Agent 可以调用接口创建和修改图形；支持预览的操作可交给用户检查、确认后再应用。修改结果仍可继续编辑或撤销。

例如，你的 Agent 应用可以把“移动选中的设备”转成一次待确认的移动操作，让用户批准后应用到当前图纸。批准后的修改和手动编辑一样，可以撤销。

- [构建 Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/)：调用绘图工具，检查修改并应用。
- [Agent 接入说明](docs/agent.md)：供编程 Agent 使用的接入指南。
- [运行命令示例](examples/agent-command.mjs)：无需模型或 API Key，即可验证提议修改、批准和撤销。

## 文件与自动化

无需 AI 模型，也可以通过代码或命令行读取、编辑和保存图纸。用法见[文件指南](https://kanjieteam.github.io/kjdraw/docs/latest/files/)。

KJDraw 支持原生 KJD 图纸、KJP 工程，以及有明确[兼容范围的 DXF](docs/dxf-compatibility.md)。当前不支持直接打开 DWG。

## 参与贡献

**我们的使命，是让 KJDraw 成为 AI 时代首选的开源 CAD 引擎。**

带来一张能复现问题的图纸、接入你正在开发的应用，或者一起改进引擎。几何与文件兼容、编辑工具、Agent 示例、无障碍、性能和文档，都是直接帮助用户的贡献方向。

从[贡献指南](CONTRIBUTING.md)了解开发流程，从[治理规则](GOVERNANCE.md)了解决策和维护方式。较大改动请先通过 [Issue](https://github.com/KanJieTeam/kjdraw/issues) 讨论设计。

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run dev
```

访问 **http://localhost:4173**。提交修改前运行 `npm run typecheck` 和 `npm test`；界面修改还需运行 `npm run test:browser`。

[使用文档](https://kanjieteam.github.io/kjdraw/docs/latest/) · [API 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/) · [路线图](docs/roadmap.md) · [获取支持](SUPPORT.md) · [版本状态](docs/status.md) · [许可证](LICENSE)

## Star History

<p align="center"><a href="https://www.star-history.com/#KanJieTeam/kjdraw&Date"><img src="https://api.star-history.com/svg?repos=KanJieTeam/kjdraw&type=Date" alt="KJDraw Star History" width="680"></a></p>

**由 [KanJieTeam](https://github.com/KanJieTeam) 发起，欢迎全球开发者参与。**

[kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0
