---
slug: installation
title.en: Installation
title.zh: 安装
summary.en: Install the published GitHub Release today, then choose the npm channel, runtime and import path that match your application.
summary.zh: 立即安装已发布的 GitHub Release，并根据应用形态选择后续 npm 渠道、运行环境和导入路径。
---
:::en
## Requirements {#requirements}

- Node.js 22 or newer for repository tooling and supported Node.js consumers.
- A modern browser with ES modules, Canvas 2D, WebAssembly and Web Crypto for browser products.
- npm, pnpm or another package manager that understands package exports.

KJDraw's core has no runtime npm dependencies. React and Vue are optional peer dependencies: install the framework your application uses when importing `/react` or `/vue`. Headless and plain TypeScript applications do not need either framework.

## Release channels {#release-channels}

| Intent | Command |
| --- | --- |
| Install published RC2 now | `npm install https://github.com/KanJieTeam/kjdraw/releases/download/v1.0.0-rc.2/kanjieteam-kjdraw-1.0.0-rc.2.tgz` |
| Evaluate the current RC after npm publication | `npm install @kanjieteam/kjdraw@next` |
| Reproduce RC2 from npm after it becomes available | `npm install @kanjieteam/kjdraw@1.0.0-rc.2` |
| Install stable after npm promotion | `npm install @kanjieteam/kjdraw` |
| Work from a checkout | `npm install /path/to/kjdraw/packages/kjdraw-sdk` |

The `v1.0.0-rc.2` GitHub Release and tarball are published; npm registry publication is pending. Until the package page lists this candidate, use the release tarball above. Once npm is available, prereleases use `next` and stable versions use `latest`.

## Public imports {#public-imports}

Use the root for the common SDK surface and subpaths when you want a smaller, explicit contract.

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
import { KJDeploymentRegistry } from '@kanjieteam/kjdraw/deployment'
```

Every declared package export appears in the generated API reference and is verified against the package manifest in CI.
:::
:::zh
## 环境要求 {#requirements}

- 仓库工具链和受支持的 Node.js 消费端使用 Node.js 22 或更高版本。
- 浏览器产品需要支持 ES Modules、Canvas 2D、WebAssembly 与 Web Crypto 的现代浏览器。
- npm、pnpm 或其他能够解析 package exports 的包管理器。

KJDraw 核心的 npm 运行时依赖为零。React、Vue 是可选 peer dependency：导入 `/react` 或 `/vue` 时，安装应用所用的框架即可。无界面程序和原生 TypeScript 应用无需安装这两个框架。

## 发布渠道 {#release-channels}

| 目标 | 命令 |
| --- | --- |
| 立即安装已发布的 RC2 | `npm install https://github.com/KanJieTeam/kjdraw/releases/download/v1.0.0-rc.2/kanjieteam-kjdraw-1.0.0-rc.2.tgz` |
| npm 发布后评估当前候选版 | `npm install @kanjieteam/kjdraw@next` |
| npm 可用后精确复现 RC2 | `npm install @kanjieteam/kjdraw@1.0.0-rc.2` |
| npm 晋级稳定版后安装 | `npm install @kanjieteam/kjdraw` |
| 从本地 checkout 使用 | `npm install /path/to/kjdraw/packages/kjdraw-sdk` |

`v1.0.0-rc.2` GitHub Release 与 tarball 已经发布，npm Registry 发布仍在处理中。在 npm 包页面列出该候选版之前，请使用上面的 Release tarball。npm 可用后，预发布版本使用 `next`，稳定版本使用 `latest`。

## 公共导入路径 {#public-imports}

常用 SDK 能力从根入口导入；当你希望边界更小、更明确时使用子路径。

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDXFFileAdapter } from '@kanjieteam/kjdraw/file/dxf'
import { KJDeploymentRegistry } from '@kanjieteam/kjdraw/deployment'
```

所有 package exports 都会进入自动生成的 API Reference，并由 CI 对照包清单验证。
:::
