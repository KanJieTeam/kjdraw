---
slug: mcp
title.en: MCP integration
title.zh: MCP 集成
summary.en: Expose bounded CAD reads and reviewable proposals to an MCP client without giving the model file or approval authority.
summary.zh: 通过 MCP 向智能体提供有界图纸读取与可审核提案，同时不授予模型文件写入或批准权限。
---
:::en
## Start a local stdio server {#start-server}

The MCP executable is part of the **1.0.0-rc.3 source candidate**, not necessarily the package currently served by npm's `next` tag. Check whether that exact version is published before installing it:

```sh
npm view @kanjieteam/kjdraw@1.0.0-rc.3 version
```

If the registry does not return `1.0.0-rc.3`, follow the [source-checkout installation](https://kanjieteam.github.io/kjdraw/docs/latest/installation/#en-installation-release-channels); do not install `@next` and assume it contains `kjdraw-mcp.mjs`. Once the exact version is published, install it in a host-owned Node.js 22+ project:

```sh
npm install @kanjieteam/kjdraw@1.0.0-rc.3
node node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs --check-tool-schemas
```

Create empty `proposals` and `results` directories, then start the verified executable with absolute host-selected paths:

```sh
node /absolute/project/node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs --workspace /absolute/project --blank drawing.kjd --units millimeter --proposal-dir proposals --candidate-dir results
```

Use `--input drawing.kjd` or `--input drawing.dxf` instead of `--blank` to inspect an existing drawing. Relative drawing and output paths are resolved inside `--workspace`; the server rejects path escapes, symbolic-link traversal and conflicting output files. `--candidate-dir` is an explicit host policy that lets exact create proposals produce new KJD, DXF and SVG candidates. It does not let the model choose a path or overwrite the input.

For a persistent desktop-client connection, use the absolute installed script path in the client's stdio configuration instead of relying on a temporary package-manager cache. The [AI client installer](https://github.com/KanJieTeam/kjdraw/blob/main/docs/try-in-ai.md) performs a safe user-level merge for supported clients.

## Configure an MCP client {#client-config}

To see the protocol from a real host process before editing desktop-client configuration, run the maintained [TypeScript MCP client starter](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/mcp-client). It performs initialize, tool discovery and a reviewable circle proposal against the packaged stdio server.

The exact outer configuration key varies by client. The server entry itself has this shape; replace every placeholder with a real absolute path selected by the host:

```json
{
  "command": "node",
  "args": [
    "/absolute/project/node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs",
    "--workspace", "/absolute/project",
    "--blank", "drawing.kjd",
    "--units", "millimeter",
    "--proposal-dir", "proposals",
    "--candidate-dir", "results"
  ]
}
```

Restart the client after saving its configuration. Ask `Use KJDraw to draw a circle with a 5 mm radius.` A successful create flow calls a KJDraw proposal tool and reports a `candidate-ready` result with new candidate paths. The original host drawing remains unchanged.

## Inspect one tool call {#tool-call}

MCP clients perform this JSON-RPC exchange. It is useful for understanding logs and building a test harness; an end user does not type it into chat:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"host-test","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cad_propose_circles","arguments":{"expectedRevision":0,"units":"millimeter","circles":[{"center":{"x":20,"y":20},"radius":5}]}}}
```

The proposal response has `status: "awaiting-host-approval"`; with the candidate-directory policy, the server can additionally materialize the exact create proposal as a new candidate set. There is no MCP approve, save, open or arbitrary-command tool. A trusted host owns review, authentication and any later mutation of an existing drawing.

## Verify the boundary {#verify-boundary}

Check all of these before treating a client as connected:

1. `tools/list` contains KJDraw tools such as `cad_read_drawing` and `cad_propose_circles`.
2. The call uses the current drawing revision and canonical drawing units.
3. The response contains structured proposal geometry, not only model prose.
4. A create flow writes new candidates only under the host-selected directory.
5. The input KJD or DXF bytes and revision remain unchanged until a trusted host applies an approved operation.

Run `node node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs --check-tool-schemas` to validate both supported unit profiles without starting a client. Continue with [Agent workflows](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) for proposal previews and approval handling, or [Connect your model](https://kanjieteam.github.io/kjdraw/docs/latest/models/) for direct provider adapters.
:::
:::zh
## 启动本地 stdio 服务 {#start-server}

MCP 可执行文件属于 **1.0.0-rc.3 源码候选版**，npm `next` 标签当前不一定提供它。安装前先查询这个确切版本是否已发布：

```sh
npm view @kanjieteam/kjdraw@1.0.0-rc.3 version
```

如果仓库未返回 `1.0.0-rc.3`，请按[源码安装步骤](https://kanjieteam.github.io/kjdraw/docs/latest/installation/#zh-installation-release-channels)操作；不要安装 `@next` 后直接假定存在 `kjdraw-mcp.mjs`。确切版本发布后，可在宿主管理的 Node.js 22+ 工程中安装并校验：

```sh
npm install @kanjieteam/kjdraw@1.0.0-rc.3
node node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs --check-tool-schemas
```

创建空的 `proposals`、`results` 目录，再用宿主选择的绝对路径启动已校验的可执行文件：

```sh
node /absolute/project/node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs --workspace /absolute/project --blank drawing.kjd --units millimeter --proposal-dir proposals --candidate-dir results
```

检查已有图纸时，把 `--blank` 换成 `--input drawing.kjd` 或 `--input drawing.dxf`。图纸和输出的相对路径都在 `--workspace` 内解析；服务会拒绝路径越界、符号链接穿越和输出文件冲突。`--candidate-dir` 是宿主明确开启的策略，允许把准确的新建提案写成新的 KJD、DXF、SVG 候选文件，但模型不能选择路径，也不能覆盖输入图纸。

桌面客户端需要长期连接时，应在 stdio 配置中使用已安装脚本的绝对路径，不要依赖包管理器的临时缓存。[智能体客户端安装器](https://github.com/KanJieTeam/kjdraw/blob/main/docs/try-in-ai.zh-CN.md)可以为已支持客户端安全合并当前用户配置。

## 配置 MCP 客户端 {#client-config}

修改桌面客户端配置前，可以先运行仓库维护的 [TypeScript MCP 客户端起步工程](https://github.com/KanJieTeam/kjdraw/tree/main/examples/starters/mcp-client)，查看真实宿主进程完成初始化、工具发现与可审核圆提案。

不同客户端外层配置键名可能不同，服务条目本身如下。请把每个占位符换成宿主选择的真实绝对路径：

```json
{
  "command": "node",
  "args": [
    "/absolute/project/node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs",
    "--workspace", "/absolute/project",
    "--blank", "drawing.kjd",
    "--units", "millimeter",
    "--proposal-dir", "proposals",
    "--candidate-dir", "results"
  ]
}
```

保存配置后重启客户端，然后输入“用 KJDraw 画一个半径 5 毫米的圆”。新建闭环成功时，客户端会调用 KJDraw 提案工具，并返回带有新候选路径的 `candidate-ready` 结果；宿主输入图纸保持不变。

## 查看一次工具调用 {#tool-call}

MCP 客户端实际执行以下 JSON-RPC 交换。它适合检查日志和编写测试宿主，普通用户无需把这些内容输入对话：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"host-test","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cad_propose_circles","arguments":{"expectedRevision":0,"units":"millimeter","circles":[{"center":{"x":20,"y":20},"radius":5}]}}}
```

提案响应的状态是 `status: "awaiting-host-approval"`；启用候选目录策略后，服务还可以把准确的新建提案物化为新的候选文件组。MCP 不提供批准、保存、打开图纸或任意命令执行工具。审核、认证以及对已有图纸的后续修改始终由可信宿主管理。

## 验证安全边界 {#verify-boundary}

在把客户端视为连接成功前，应同时检查：

1. `tools/list` 包含 `cad_read_drawing`、`cad_propose_circles` 等 KJDraw 工具；
2. 调用使用图纸的当前修订号和标准单位名；
3. 响应包含结构化提案几何，而不是只有模型文字；
4. 新建流程只在宿主选择的目录中写出新候选文件；
5. 可信宿主应用获批操作前，输入 KJD/DXF 的字节和修订号保持不变。

运行 `node node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs --check-tool-schemas`，无需启动客户端即可校验两种单位配置。随后可阅读 [Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/)了解提案预览与审批，或阅读[接入你的模型](https://kanjieteam.github.io/kjdraw/docs/latest/models/)使用模型厂商适配器。
:::
