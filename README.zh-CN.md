<div align="center">

<img src="docs/assets/mark.svg" width="72" alt="KJDraw logo" />

# KJDraw

### 给 AI 装上真正的 CAD 能力

模型只需表达工程意图，KJDraw 负责把它编译为<br/>
可编辑、可验证、可撤销、可保存重开的真实 CAD 图纸。

[**快速开始**](#-快速开始) · [**AI 绘图**](https://kanjieteam.github.io/kjdraw/ai/) · [**在线编辑器**](https://kanjieteam.github.io/kjdraw/) · [**文档**](https://kanjieteam.github.io/kjdraw/docs/latest/) · [**贡献技能包**](docs/contributing-skills.zh-CN.md) · [English](README.md)

[![GitHub release](https://img.shields.io/github/v/release/KanJieTeam/kjdraw?include_prereleases&style=flat-square&labelColor=30363d&color=2863f0)](https://github.com/KanJieTeam/kjdraw/releases)
[![npm next](https://img.shields.io/npm/v/@kanjieteam/kjdraw/next?style=flat-square&label=npm&labelColor=30363d&color=2863f0)](https://www.npmjs.com/package/@kanjieteam/kjdraw)
[![License](https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d)](LICENSE)

</div>

<p align="center">
  <a href="https://kanjieteam.github.io/kjdraw/">
    <img src="docs/media/kjdraw-workflow.gif" alt="KJDraw 工作台：打开图纸、审核改动、绘制并标注零件" width="100%" />
  </a>
  <br/>
  <sub>录制于内置工作台，图中 Agent 面板播放的是预设场景。在真实 AI 客户端中使用，请看下方快速开始。</sub>
</p>

## 画出来，还能继续改

KJDraw 生成的是可编辑的 CAD 对象，不是一次性图片。让智能体画一个零件后，还可以继续改孔径、移动对象或调整图层，无需整张重画。每次修改先预览、再确认；需要时可以撤销、保存并重新打开。

**模型决定画什么，KJDraw 负责执行 CAD 操作。**

## 🚀 快速开始

在 Codex、Claude Code、Cursor 等支持终端的智能体中使用（需要 Node.js 22+），只需执行一次：

```sh
npm install -g @kanjieteam/kjdraw@next
npx skills add KanJieTeam/kjdraw -g
```

第一条安装 CAD 引擎；简短的第二条让你选择把 Skill 加到哪个智能体。重启智能体后，直接说：

```text
用 KJDraw 画一个半径 5 毫米的圆。
```

Skill 在本地调用 `kjdraw agent`，**不用注册 MCP，也不用把模型 API Key 给 KJDraw**。修改会先生成待审提案，须由真人批准。[其他智能体与可选 MCP 接入](docs/try-in-ai.zh-CN.md)。

想试一张更像工程图的图纸，可以说：“用 KJDraw 画一张毫米单位的六孔法兰图：外径 120、内孔 40、厚 20、螺栓孔中心圆直径 90、六个孔直径 10；标题为‘六孔法兰’，图号 DEMO-FLANGE。”已发布的 rc.3 工具会先生成待审提案，**不是自动批准的成品**。[审核并重开 KJD/DXF 候选文件](docs/try-in-ai.zh-CN.md#skill-优先的本地-cli)。

想直接在浏览器里试？[AI 绘图](https://kanjieteam.github.io/kjdraw/ai/)是独立对话页面。填入自己的 API Key 和允许浏览器跨域请求的模型接口；密钥仅留在当前页面内存中，CAD 修改须由你确认才应用。

## 核心能力

| 能力 | 当前范围 |
| --- | --- |
| **读懂现有图纸** | 已提供：对支持的对象进行分页读取、空间与属性查询、在线图档/KJD 内稳定的对象 ID、图层、块引用、拓扑和修改影响分析；DXF 重新导入可能生成新的内部 ID |
| **高层工程成图** | 示例工作流：机械加工图、建筑平面图、场地与管线图、道路平纵横、柱状图、地质剖面图和统计图；完整生产流程仍在验证 |
| **多轮改图** | 已提供部分命令：对支持的对象及组合进行定位、移动、复制、旋转、缩放、偏移、拉伸、延长、改文字、换图层和删除；真实模型多轮任务仍需验证 |
| **审核与修订** | 已提供：绑定图纸版本的修改提案、真人审批、单事务提交、撤销，以及在支持范围内保存和重开检查 |
| **嵌入你的产品** | 已提供：同一引擎的 TypeScript/JavaScript SDK、React、Vue、完整编辑器、CLI、MCP 和本地文件工作流 |

## KJDraw 适合你吗？

| ✅ 适合 | ⏳ 暂时不适合 |
| --- | --- |
| 你想用 AI 智能体生成和反复修改工程图纸 | 你需要直接打开和保存 DWG |
| 你在做需要修改图纸的 AI 产品，并且希望由人把关 | 你需要完整的桌面 CAD 功能或三维实体建模 |
| 你需要在 Web 产品里嵌入 CAD 编辑器（审图、巡检、选型、内部工具） | 你需要经过认证的打印或出图输出 |
| 你要在脚本或 CI 里批量处理 DXF/KJD，无界面、不上传 | |

KJDraw 是 CAD 引擎和执行层，不打算取代桌面 CAD。

## 📦 在应用中嵌入 CAD

如果你开发 JavaScript 或 TypeScript 应用，请按单独的 [SDK 快速开始](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/)在项目中安装；不需要执行上面的智能体安装命令。嵌入 API 如下：

```html
<div id="cad" style="height: 720px"></div>
```

```ts
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'

const editor = createKJDrawEditor('#cad', {
  document: 'sample',
  locale: 'zh-CN',
  theme: 'dark',
  layout: 'classic', // 'classic' | 'compact' | 'focus'
})

await editor.ready
// await editor.open(file)                              // 来自文件选择框的 File
// await editor.save({ format: 'DXF', download: true })
```

<details>
<summary><b>React</b></summary>

```tsx
import { KJDraw } from '@kanjieteam/kjdraw/react'

export default function DrawingPage() {
  return <KJDraw document="sample" locale="zh-CN" style={{ height: 720 }} />
}
```

</details>

<details>
<summary><b>Vue 3</b></summary>

```vue
<script setup lang="ts">
import { KJDraw } from '@kanjieteam/kjdraw/vue'
</script>

<template>
  <KJDraw document="sample" locale="zh-CN" style="height: 720px" />
</template>
```

</details>

[快速开始](https://kanjieteam.github.io/kjdraw/docs/latest/quickstart/) · [React 指南](https://kanjieteam.github.io/kjdraw/docs/latest/react/) · [Vue 指南](https://kanjieteam.github.io/kjdraw/docs/latest/vue/) · [可运行示例](packages/kjdraw-sdk/examples) · [API 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/)

## 🤖 在你自己的产品里构建 CAD Agent

你的应用负责接入模型，KJDraw 提供 CAD 工具、审核环节和撤销历史。

```mermaid
sequenceDiagram
    participant U as 用户
    participant M as 你的模型
    participant K as KJDraw
    U->>M: "把水泵向东移动 500 mm"
    M->>K: 查询图纸（图层、图元、几何）
    K-->>M: 只读结果，绑定当前版本
    M->>K: 提出移动方案
    K-->>U: 预览具体改动
    U->>K: 批准
    K->>K: 作为一个事务提交（可撤销）
```

每个修改提议都绑定到提出时的图纸版本、只能使用一次，批准后作为一个完整事务提交，撤销方式和手动编辑一样。

- [构建 Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/)：调用绘图工具，检查修改并应用
- [接入模型](https://kanjieteam.github.io/kjdraw/docs/latest/models/)：模型传输、预算和审批由宿主掌控
- [Agent 接入说明](docs/agent.md)：给编程 Agent 使用的接入指南
- [命令示例](examples/agent-command.mjs)：无需模型或 API Key，验证提议、批准和撤销

## 目前能做什么

| 方面 | 状态 |
| --- | --- |
| **KJD** 原生图纸 | ✅ 读写、校验、事务、版本、撤销/重做 |
| **KJP** 工程包 | ✅ 一个包内多张图纸，含快照、哈希和命令日志 |
| **DXF**（ASCII） | ✅ 有明确说明的子集，R14–2024 版本标签，见 [兼容范围](docs/dxf-compatibility.md) |
| 二进制 DXF | ❌ 不支持 |
| **DWG** | ❌ 不在 1.0 范围内，请先转换为 DXF（例如使用 ODA File Converter） |
| **3D** | 🧪 实验性：网格、基本体和盒体布尔运算 |
| 命令行 | ✅ 无界面检查、校验和转换 KJD、KJP、DXF，见 [文件指南](https://kanjieteam.github.io/kjdraw/docs/latest/files/) |

不支持的内容会被明确拒绝，而不是悄悄丢弃。完整边界见 [版本状态](docs/status.md) · [1.0 范围](docs/1.0-scope.md)。

## 参与贡献

**我们的使命：让 KJDraw 成为 AI 时代首选的开源 CAD 引擎。**

[贡献独立技能包](docs/contributing-skills.zh-CN.md) · [技能目录与样例](skills/README.md) · [其他贡献类型](CONTRIBUTING.zh-CN.md) · [English Skill guide](docs/contributing-skills.md)。在 `skills/kjdraw-<topic>/` 中复用已有 CAD 运行时，定义输入、产物与验收，再提交一个小型 PR。新工作流通常不需要修改内核。

现在最有价值的贡献：

- **一个可安装的领域 Skill。** 参考[文字核对样例](skills/kjdraw-text-audit/README.zh-CN.md)，保留自己的短 `SKILL.md` 与必要资源，添加验证实际工作流的测试。
- **一个可复现的图纸问题。** 提交小型合成 DXF 或有权公开的最小样例，写明操作指令和预期结果；不要上传客户私有图纸。
- **一个可复用的工程工作流。** 有明确输入、可编辑 CAD 产物，以及修改、撤销、DXF 重开的测试。从[领域规划器示例](examples/domain-planner-starter/README.md)开始。
- **在你用的 AI 客户端里试用并反馈**，尤其是生成失败或多轮修改出错的案例。
- **编辑工具、成图类型、性能、无障碍和文档。**

```bash
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run dev          # http://localhost:4173
```

提交 PR 前请运行 `npm run typecheck` 和 `npm test`（界面修改还需 `npm run test:browser`）。较大改动请先 [开 Issue](https://github.com/KanJieTeam/kjdraw/issues) 讨论。参见 [贡献指南](CONTRIBUTING.md) · [治理规则](GOVERNANCE.md) · [路线图](docs/roadmap.md) · [获取支持](SUPPORT.md)。

## Star History

[![KJDraw Star History](https://api.star-history.com/svg?repos=KanJieTeam/kjdraw&type=Date)](https://www.star-history.com/#KanJieTeam/kjdraw&Date)

---

<div align="center">

如果 KJDraw 对你有用，点个 ⭐ 能帮更多工程师发现它。

由 [KanJieTeam](https://github.com/KanJieTeam) 发起，欢迎全球开发者参与 · [kanjieteam@163.com](mailto:kanjieteam@163.com) · [Apache-2.0](LICENSE)

</div>
