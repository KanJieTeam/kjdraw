<p align="center"><img src="docs/assets/mark.svg" alt="KJDraw" width="80" height="80"></p>

<h1 align="center">KJDraw</h1>

<p align="center"><strong>面向工程师与 AI 的 CAD。</strong></p>

<p align="center">开源 CAD 引擎，以及拿来就能用的绘图编辑器。<br>开发你的工程绘图应用，让 AI 拥有创建和修改图纸的工具。</p>

<p align="center">
  <a href="https://kanjieteam.github.io/kjdraw/"><strong>在线体验</strong></a> ·
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

<p align="center"><a href="https://kanjieteam.github.io/kjdraw/"><img src="docs/media/kjdraw-workflow-zh.gif" alt="KJDraw 工作台：浏览图纸，审核预设修改，绘制安装板、阵列螺栓孔并标注尺寸" width="100%"></a></p>

<p align="center"><sub>真实工作台录制：浏览图纸、审核预设修改，再从空白绘制零件并标注尺寸。当前 Agent 场景使用预设流程，未连接语言模型。</sub></p>

## 你的图纸，你的应用，你的 AI

KJDraw 提供绘制平面图和零件图、修改已有图形、保存可编辑成果的工具。你可以直接在浏览器里画图，把编辑器嵌入自己的产品，也可以让程序和 AI Agent 调用这些绘图能力。

- **成果可以接着改。** 图纸包含能够选中和修改的直线、圆弧、尺寸和图层，不是一张只能看的图片。
- **人和程序接力工作。** 自动修改完成后，人可以继续在同一张图上编辑，并使用同一套撤销记录。
- **现成工作台，接入就能用。** 绘图工具、图层、特性、文件操作和三种布局已经备好，支持中英文界面。
- **用来建设你自己的产品。** 直接使用完整编辑器、自定义界面，或者加入面向自己行业的绘图工具。

**我们的使命，是让 KJDraw 成为 AI 时代首选的开源 CAD 引擎。**

## 亲手改一张图，看看它能做什么

[打开在线编辑器](https://kanjieteam.github.io/kjdraw/)，无需注册或上传文件即可体验样例。

1. 选择机械详图、建筑平面、场地总图或道路纵断面。
2. 选中并移动对象、查看图层，或者从空白开始画一个零件。
3. 撤销一次修改，保存图纸，再打开继续编辑。

这些原创样例均可编辑，不含客户数据，用于体验工作流程，不作为施工图使用。[工作台操作指南](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/)提供绘图、选择、标注与保存说明。

## 接入你的应用

安装候选版：

```sh
npm install @kanjieteam/kjdraw@next
```

以下示例需要 **1.0.0-rc.3 或更新版本**。用 `npm list @kanjieteam/kjdraw` 核对；`next` 是候选版渠道，`latest` 可能仍是较旧版本。源码可能包含尚未发布到 npm 的修改，详见[版本状态](docs/status.md)。

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

你的应用负责接入 AI 模型，KJDraw 提供绘图工具。让 Agent 调用接口创建和修改对象，把已支持的编辑预览交给用户检查，再保存成人可以继续编辑的图纸。

例如，你的 Agent 应用可以把“移动选中的设备”转成一次待确认的移动操作，让用户批准后应用到当前图纸。批准后的修改和手动编辑一样，可以撤销。

当前 SDK 已提供绘图命令和修改审核流程。能够理解任意设计需求的通用助手仍在建设中，尚未包含在当前 Demo 中。

- [构建 Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/)：调用绘图工具，检查修改并应用。
- [Agent 接入说明](docs/agent.md)：交给编程 Agent 使用本库的文档入口。
- [运行命令示例](examples/agent-command.mjs)：无需模型或 API Key，即可验证提议修改、批准和撤销。

不使用 AI，也可以自动化处理图纸。[文件指南](https://kanjieteam.github.io/kjdraw/docs/latest/files/)介绍程序和命令行中的读取、编辑与保存。KJDraw 支持原生 KJD 图纸、KJP 工程，以及有明确[兼容范围的 DXF](docs/dxf-compatibility.md)；当前不包含直接打开 DWG 的能力。

## 欢迎一起打磨

带来一张能复现问题的图纸、接入你正在开发的应用，或者一起改进引擎。几何与文件兼容、编辑工具、Agent 示例、无障碍、性能和文档，都是直接帮助用户的贡献方向。

从[贡献指南](CONTRIBUTING.md)了解开发流程，从[治理规则](GOVERNANCE.md)了解决策和维护方式。较大改动请先通过 [Issue](https://github.com/KanJieTeam/kjdraw/issues) 讨论设计。

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run dev
```

访问 **http://localhost:4173**。提交修改前运行 `npm run typecheck` 和 `npm test`；界面修改还需运行 `npm run test:browser`。

[使用文档](https://kanjieteam.github.io/kjdraw/docs/latest/) · [API 参考](https://kanjieteam.github.io/kjdraw/docs/latest/api/) · [路线图](docs/product/roadmap-to-core.md) · [获取支持](SUPPORT.md) · [版本状态](docs/status.md) · [许可证](LICENSE)

**由 [KanJieTeam](https://github.com/KanJieTeam) 发起，欢迎全球开发者参与。**

[kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0
