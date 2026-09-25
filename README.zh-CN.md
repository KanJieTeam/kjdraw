<p align="center"><img src="docs/assets/hero.svg" alt="KJDraw——面向 AI 智能体的工程图纸运行时" width="100%"></p>

<p align="center"><strong>面向 AI 智能体的开源工程图纸运行时。</strong></p>

<p align="center">
  通过高层工程编译器、稳定对象身份和事务化编辑构建工程绘图工作流，
  并以同一运行时连接浏览器、Node.js、CLI 与 MCP。
</p>

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

## KJDraw 是什么？

KJDraw 是以 TypeScript 为核心的开源 CAD 引擎和智能体运行时，用来把工程绘图能力嵌入自己的产品。人、应用和 AI 可以通过同一套接口创建、读取、编辑、校验、预览并交付结构化图纸，结果不是截图，也不是无法继续修改的黑盒文件。

适合以下场景：

- 给 AI 提供有边界的高层 CAD 工具，而不是让模型逐个猜测和输出数百个坐标；
- 在浏览器、React 或 Vue 应用中嵌入可编辑 CAD 工作台；
- 通过稳定对象 ID、图层、引用和空间查询读懂现有图纸；
- 把已经支持的工程意图确定性编译为原生 CAD 实体；
- 通过诊断、撤销重做、KJD/DXF 重开和 SVG 渲染证据验证结果；
- 让图纸和模型凭据留在用户自己的本地环境。

KJDraw 不是图片生成器，也不是一组固定模板。它是工程意图与可审核 CAD 交付物之间的执行层。

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

## AI 智能体接入

使用 [Skills CLI](https://github.com/vercel-labs/skills)，一行命令将 KJDraw CAD Skill 安装到当前项目中已支持的智能体：

```bash
npx skills add KanJieTeam/kjdraw
```

Skill 负责告诉智能体何时、如何调用 KJDraw；它不会安装 CAD 引擎，也不会自动连接可执行的 MCP 服务。要让智能体实际读图和绘图，还需按下文配置 KJDraw MCP，或使用已支持的桌面客户端安装器。Skills CLI 默认安装到当前项目；加 `-g` 可安装到当前用户。

KJDraw 通过标准 **stdio MCP** 提供 CAD 工具。只要客户端支持 MCP，就可以使用同一套连接配置；模型、图纸和审批仍由客户端或本地宿主掌控。

| 客户端 / 接入方式 | 配置方式 | 适合场景 | 入口 |
| --- | --- | --- | --- |
| **OpenAI Codex** | 在 Codex 的 MCP 配置中加入下方 `kjdraw` server | 代码型 Agent 生成、检查和修改 KJD/DXF | [模型接入](https://kanjieteam.github.io/kjdraw/docs/latest/models/) |
| **Claude Desktop / Cursor / Cline** | 在客户端 MCP 配置中加入下方 `kjdraw` server | 通用对话、IDE 内绘图和文件审阅 | [MCP 集成](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/) |
| **Kimi Code / WorkBuddy / ZCode / TraeCode** | 运行一次用户级安装器；按客户端提示确认导入 | 国内桌面 Agent 的本地绘图工作流 | [安装与安全边界](docs/try-in-ai.zh-CN.md) |
| **豆包 / DeepSeek / 其他国产模型** | 通过支持 MCP 的宿主接入同一 server；模型 API Key 留在宿主 | 企业内网、国产模型和自建 Agent | [Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) |
| **自建 Agent / Harness / 企业平台** | 注册同一个 stdio MCP server，或调用 `agent-tools` / `model-adapters` | 私有部署、自定义 UI 和审批系统 | [模型接入](https://kanjieteam.github.io/kjdraw/docs/latest/models/) |
| **不接模型** | 使用 TypeScript SDK、CLI 或在线编辑器 | 回归测试、批处理和人工编辑 | [文件工作流](https://kanjieteam.github.io/kjdraw/docs/latest/files/) |

以下配置要求本地已构建包含 `kjdraw-mcp.mjs` 的 1.0.0-rc.3 源码包、Node.js 22+，并在宿主工程中建好 `proposals`、`results` 目录；先将两个 `/absolute/project` 替换为真实绝对路径。npm `next` 可能仍指向旧候选版，不能只凭文档中的源码版本推断已发布。客户端再按自身格式保存 MCP server 配置：

```jsonc
{
  "mcpServers": {
    "kjdraw": {
      "command": "node",
      "args": ["/absolute/project/node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs", "--workspace", "/absolute/project", "--blank", "drawing.kjd", "--units", "millimeter", "--proposal-dir", "proposals", "--candidate-dir", "results"]
    }
  }
}
```

接入后先让 Agent 调用只读查询和预览工具，再由宿主审核提案；KJDraw 不会把模型回复当作 CAD 成功证据，也不会未经批准覆盖源图。完整工具清单、审批协议和模型适配器见：[Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) · [MCP 集成](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/) · [API 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/)。
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

### 体验在线编辑器

[打开在线编辑器](https://kanjieteam.github.io/kjdraw/)，无需注册或上传文件。可体验机械、建筑、场地和道路样例，检查图层、执行修改、撤销、保存并重新打开。样例仅用于产品体验，不作为施工图使用。详见[工作台操作指南](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/)。

## 接入你的应用

安装候选版：

```sh
npm install @kanjieteam/kjdraw@next
```

以下示例需要 **1.0.0-rc.3 或更新版本**。使用 `next` 前先运行 `npm view @kanjieteam/kjdraw dist-tags` 确认实际安装版本；若尚未发布 rc.3，请从当前源码构建。已发布版本及尚未发布到 npm 的源码更新，详见[版本状态](docs/status.md)。

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
