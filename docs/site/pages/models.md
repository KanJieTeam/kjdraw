---
slug: models
title.en: Connect your model
title.zh: 接入你的模型
summary.en: Bring your model, gateway or agent framework. Keep one CAD engine and one set of drawing tools.
summary.zh: 接入你选择的模型、网关或 Agent 框架，共用一套 CAD 引擎与绘图工具。
---
:::en
## Choose a connection {#connection}

KJDraw does not require a particular AI vendor. Choose a protocol adapter, supply your model and host transport, and run the same CAD tools. A custom `KJAgentModel` connects frameworks, local models or other protocols without changing the drawing engine.
## Agent and client matrix {#agent-client-matrix}

The drawing contract is independent of the model vendor. A client that can launch an stdio MCP server can use the same KJDraw tools; clients without native MCP support can connect through an MCP-capable host or call the TypeScript adapter directly.

| Client or model family | Recommended path | What changes | What stays the same |
| --- | --- | --- | --- |
| OpenAI Codex | Register the `kjdraw` stdio server in Codex MCP settings | Client configuration only | Tool names, proposals and approval boundary |
| Claude Desktop, Cursor, Cline | Add the same server entry to the client's MCP configuration | Client configuration only | KJD/DXF document contract |
| Kimi Code, WorkBuddy, ZCode, TraeCode | Run the user-level installer and follow the client's import prompt | Client configuration and one-time import | Local files and host approval |
| Doubao, DeepSeek and other domestic models | Use an MCP-capable host, or pass their tool-call JSON through `createKJModelAdapter` / `createKJDomesticModelAdapter` | Provider endpoint and transport | CAD tools, validation and receipts |
| Custom harness, gateway or private model | Implement `KJAgentModel` or expose the stdio server from the host | Your conversation loop and credentials | The KJDraw agent session and document model |

Portable MCP entry:

```jsonc
{
  "mcpServers": {
    "kjdraw": {
      "command": "npx",
      "args": ["-y", "@kanjieteam/kjdraw", "mcp"]
    }
  }
}
```

KJDraw does not discover provider keys, choose network endpoints or approve edits. Keep those responsibilities in the client or host and treat model text as untrusted input.

| Connection | Adapter value | Host transport |
| --- | --- | --- |
| OpenAI Responses | `responses` | Responses REST endpoint |
| Chat Completions-compatible services | `chat-completions` | The selected service's compatible endpoint; DeepSeek is one evaluation option |
| Claude Messages | `anthropic-messages` | Messages REST endpoint |
| Gemini GenerateContent | `gemini-generate-content` | GenerateContent REST endpoint, with model in the URL |
| Your framework, gateway or local model | Custom `KJAgentModel` | Your own conversation bridge |

The built-in adapters support the protocols listed above. Compatibility with a particular model or vendor extension depends on that endpoint's function-calling behavior. For text-only models, a custom bridge can parse and validate a structured response; never execute model-generated JavaScript.

## Wire the model once {#quickstart}

Install KJDraw, then import the model adapter and bounded task runner from their public package entries:

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'
import { createKJModelAdapter } from '@kanjieteam/kjdraw/model-adapters'
import { runKJAgentTask } from '@kanjieteam/kjdraw/agent-runner'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)
const model = createKJModelAdapter({
  protocol: 'chat-completions',
  model: selectedModel,
  request: ({ body, signal }) => hostModelGateway(body, signal),
})
const result = await runKJAgentTask({
  session,
  model,
  prompt: 'Propose a circle at (20, 25) mm with a radius of 3 mm.',
  toolNames: ['cad_read_drawing', 'cad_propose_circles'],
  maxTurns: 8,
  maxToolCalls: 32,
})
```

`selectedModel` and `hostModelGateway` belong to your application. The gateway returns parsed, non-streaming provider JSON and rejects HTTP failures. For Gemini, send the body to the configured model URL; this is a REST adapter, not the Google SDK's nested `config` argument. Keep keys, endpoint allowlists and user permissions on your server. The CAD package does not discover keys, choose an endpoint or send network requests by itself.

Chat-compatible endpoints differ in output token fields: the default is `max_tokens`; set `chatTokenParameter: 'max_completion_tokens'` when required. The other adapters map `maxOutputTokens` to their protocol. Full runtime argument validation remains enabled; Responses explicitly uses non-strict tool generation rather than promising identical provider-side schema support.

## Choose tools for a task {#task-tools}

`toolNames` is an optional host policy for one run. Omit it to retain all session tools. Supply a nonempty list of unique exact names from `session.definitions`; unknown names, duplicates and empty lists fail before opening a model conversation. Definitions retain their canonical order and complete schemas, including drawing units. The runner snapshots the selection before invoking the model, so later array changes cannot widen access.

Every adapter and custom bridge receives the same selected definitions. If a response requests an omitted tool, the runner returns `failed` with `KJAGENT_TOOL_NOT_ALLOWED` before dispatching any call in that batch. The next run selects its own policy. This does not restrict trusted host calls made directly on the session, replace authentication, or allow the model to approve proposals. Include reading and pagination tools when the task needs them. Smaller schemas reduce JSON bytes; actual model token counts and task success still require provider measurements.

## Review the result {#review}

| Status | What the host should do |
| --- | --- |
| `awaiting-approval` | Display the exact proposals in `outputs`; use `proposalIds` to approve or reject from your review UI |
| `responded` | Show the model's answer or clarification; it is not evidence that a drawing task succeeded |
| `limit-reached` | Inspect results and adjust the task or budget; do not automatically retry forever |
| `cancelled` | The host cancelled or the run timed out; late model calls are not dispatched |
| `failed` | Handle the structured error; inspect private transport diagnostics on the server |

The runner stops when it has proposals. It never calls `approve()`. After an authenticated user reviews the exact arguments, your host calls `session.approve(planId, user.id)` or `session.reject(planId, user.id)` and checks the result. Model text must be displayed as untrusted text, not unsanitized HTML.

Each run starts from the drawing's current revision. After applying a proposal, submit the next request as a new run so the model reads the updated geometry. Your application owns conversation persistence and save policy. See [Agent workflows](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) for CAD tools, proposal previews and geometry checks.

To expose the same tool registry through a packaged local stdio server, follow the [MCP integration](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/) guide. It includes persistent client configuration, a real JSON-RPC call and the host-controlled file and approval boundary.

## Measure tokens and time {#usage}

`result.measurements` retains each attempted turn's usage, normalized totals, transport wall time and runner wall time. Counters come from provider response fields; missing or invalid counters remain `null`. Cache and reasoning counters are subsets or additional components according to each protocol, so they are not blindly added twice. A cancelled request without a received response has missing usage. `complete` describes observed token counters, not design completion or a billing receipt.

```ts
const { totals, transportWallMs, runWallMs, complete } = result.measurements
// Keep null as unavailable; do not replace it with zero in a benchmark.
console.log({ totals, transportWallMs, runWallMs, complete })
```

Adapters also accept `onUsage: usage => hostMetrics.record(usage)` for response observations, including rejected or truncated responses. Observer failures do not change drawing behavior. A late response after cancellation may still reach that host observer; it cannot rewrite the runner's returned measurement snapshot. `extractKJModelUsage` is available from `/model-usage` for a custom transport. No response text, credentials, inferred token counts or prices are included. Controlled live-model comparisons still require repeated matched tasks and actual provider configuration.

## Run the packaged example {#example}

```sh
node node_modules/@kanjieteam/kjdraw/examples/model-agent.mjs
```

By default, the example runs offline and demonstrates all four wire formats, host approval, saved geometry and undo without contacting a model.

To connect an online model, configure `KJDRAW_MODEL_PROTOCOL`, `KJDRAW_MODEL_NAME`, `KJDRAW_MODEL_ENDPOINT` and `KJDRAW_MODEL_API_KEY` in a trusted server or CLI environment, then add `--live`. The endpoint is the complete trusted REST URL. The example rejects redirects and URL credentials, limits response bytes and never applies live proposals automatically. It sends at most four model requests and eight tool calls; provider charges may apply.

## Extend and validate {#extend}

Implement `KJAgentModel.createConversation({ instructions, tools })` and return `next(input, signal)`. A turn returns `text` plus `calls` containing `id`, `name` and `arguments`. Inputs are either the initial prompt or ordered tool results. Keep vendor continuation data private to that conversation and preserve call/result IDs. Existing Agent runtimes can also use `KJAgentToolSession` directly and manage their own execution loop.

Adapters retain Responses reasoning items, chat reasoning fields, Claude signed thinking blocks and Gemini thought signatures in their original conversation. They do not place those fields in the public answer. Truncated, blocked, malformed or unsupported responses stop before tool dispatch. Tool validation errors can be returned to the model for bounded correction. Timeouts cannot stop a transport that ignores its signal from consuming remote resources; the host must enforce its own network and billing limits.

Protocol references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls/), [Claude tool results](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [Gemini GenerateContent](https://ai.google.dev/api/generate-content).
:::
:::zh
## 选择接入方式 {#connection}

KJDraw 不依赖特定 AI 厂商。选择协议适配器，传入模型和宿主请求函数，就能使用同一套 CAD 工具。其他框架、本地模型或协议可实现 `KJAgentModel`，无需修改绘图引擎。
## 智能体与客户端接入矩阵 {#agent-client-matrix-zh}

图档和工具契约不绑定模型厂商。能启动 stdio MCP server 的客户端可以直接使用同一套 KJDraw 工具；不原生支持 MCP 的客户端，可通过支持 MCP 的宿主转接，或直接调用 TypeScript 适配器。

| 客户端或模型家族 | 推荐路径 | 变化的部分 | 保持不变的部分 |
| --- | --- | --- | --- |
| OpenAI Codex | 在 Codex MCP 设置中注册 `kjdraw` stdio server | 客户端配置 | 工具名、提案和审批边界 |
| Claude Desktop、Cursor、Cline | 在客户端 MCP 配置中加入同一 server | 客户端配置 | KJD/DXF 图档契约 |
| Kimi Code、WorkBuddy、ZCode、TraeCode | 运行用户级安装器，按提示完成一次导入 | 客户端配置与一次导入 | 本地文件和宿主审批 |
| 豆包、DeepSeek 及其他国产模型 | 通过支持 MCP 的宿主接入，或把工具调用 JSON 交给 `createKJModelAdapter` / `createKJDomesticModelAdapter` | 模型接口和传输层 | CAD 工具、校验和回执 |
| 自建 Harness、网关或私有模型 | 实现 `KJAgentModel`，或由宿主暴露 stdio server | 会话循环和凭据管理 | KJDraw Agent 会话和图档模型 |

通用 MCP 配置：

```jsonc
{
  "mcpServers": {
    "kjdraw": {
      "command": "npx",
      "args": ["-y", "@kanjieteam/kjdraw", "mcp"]
    }
  }
}
```

KJDraw 不会搜索模型密钥、选择网络地址或批准修改；这些职责由客户端或宿主承担，模型文本始终按不可信输入处理。

| 接入方式 | 适配器值 | 宿主请求目标 |
| --- | --- | --- |
| OpenAI Responses | `responses` | Responses REST 接口 |
| Chat Completions 兼容服务 | `chat-completions` | 所选服务的兼容接口；DeepSeek 只是测试选项之一 |
| Claude Messages | `anthropic-messages` | Messages REST 接口 |
| Gemini GenerateContent | `gemini-generate-content` | GenerateContent REST 接口，模型名放在 URL 中 |
| 自有框架、网关、本地模型 | 自定义 `KJAgentModel` | 你的会话桥接实现 |

内置适配器支持上表所列协议；具体模型和厂商扩展字段的兼容性取决于对应接口的工具调用行为。纯文本模型可通过自定义桥接解析并校验结构化结果，但不能执行模型输出的 JavaScript。

## 配置一次模型连接 {#quickstart}

安装 KJDraw 后，从公开子路径导入模型适配器和有界任务运行器：

```ts
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'
import { createKJModelAdapter } from '@kanjieteam/kjdraw/model-adapters'
import { runKJAgentTask } from '@kanjieteam/kjdraw/agent-runner'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)
const model = createKJModelAdapter({
  protocol: 'chat-completions',
  model: selectedModel,
  request: ({ body, signal }) => hostModelGateway(body, signal),
})
const result = await runKJAgentTask({
  session,
  model,
  prompt: '提出一个圆的绘制方案：圆心 (20, 25) 毫米，半径 3 毫米。',
  toolNames: ['cad_read_drawing', 'cad_propose_circles'],
  maxTurns: 8,
  maxToolCalls: 32,
})
```

`selectedModel` 与 `hostModelGateway` 由应用提供。网关返回解析后的非流式模型 JSON，HTTP 失败时抛错。Gemini 适配器使用 REST 请求体，不是 Google SDK 的嵌套 `config` 参数。密钥、接口白名单和用户权限放在服务端；CAD 包不会搜索密钥、选择地址或自行联网。

兼容接口的输出 token 字段并不完全相同：默认使用 `max_tokens`，需要时设置 `chatTokenParameter: 'max_completion_tokens'`；其他适配器按各自协议映射 `maxOutputTokens`。所有工具参数仍由运行时严格校验；Responses 显式使用非 strict 生成模式，不假设各厂商的服务端 Schema 支持完全一致。

## 按任务选择工具 {#task-tools}

`toolNames` 是宿主为一次运行设置的可选权限范围。省略时保留全部会话工具；提供时必须是 `session.definitions` 中非空、不重复的确切名称。未知名称、重复项和空列表在打开模型会话前报错。选中定义保持原始顺序和完整参数约束，包括图档单位。运行器在调用模型前复制选择结果，之后修改传入数组不会扩大权限。

所有协议适配器与自定义桥接收到同一份选中定义。模型请求被省略的工具时，整批调用在任何工具执行前被拒绝，返回 `failed` 和 `KJAGENT_TOOL_NOT_ALLOWED`。下一次运行可以重新选择。这不限制宿主直接调用会话，也不代替认证，更不允许模型批准自身提案。需要读取和分页的任务应包含对应工具。缩小 Schema 能减少 JSON 字节，但实际 Token 和任务成功率仍需模型端测量。

## 处理运行结果 {#review}

| 状态 | 宿主应该做什么 |
| --- | --- |
| `awaiting-approval` | 展示 `outputs` 中的确切修改，用 `proposalIds` 在审核界面批准或拒绝 |
| `responded` | 展示模型回答或澄清问题；这不证明绘图任务已成功 |
| `limit-reached` | 检查结果并调整任务或预算，不无限自动重试 |
| `cancelled` | 用户取消或运行超时；迟到的模型调用不会再执行 |
| `failed` | 处理结构化错误，在服务端检查私有请求日志 |

一旦得到提案，运行器就停止，不会调用 `approve()`。经过认证的用户审核后，宿主再调用 `session.approve(planId, user.id)` 或 `session.reject(planId, user.id)`，并核对结果。模型回复应当作为不可信文字展示，不能直接当作 HTML 渲染。

每次运行都从图纸的当前修订版本开始。应用方案后，把后续需求作为新任务运行，让模型读取更新后的几何。对话持久化与保存策略由应用负责。CAD 工具、方案预览和几何检查见 [Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/)。

若要通过包内本地 stdio 服务向 MCP 客户端提供同一套工具注册表，请按 [MCP 集成](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/)操作。该页面给出了长期客户端配置、真实 JSON-RPC 调用，以及由宿主管理的文件和审批边界。

## 测量 token 与耗时 {#usage}

`result.measurements` 保存每个尝试轮次的用量、归一化累计值、传输墙钟耗时和运行器总耗时。计数来自服务端响应字段；缺失或无效值保留 `null`。缓存与推理 token 按各协议的包含关系处理，避免重复相加。取消后没有收到响应的请求属于用量缺失，`complete` 仅表示已观测 token 数据完整，不代表绘图完成或完整账单。

```ts
const { totals, transportWallMs, runWallMs, complete } = result.measurements
// null 表示无法取得，不能在跑分中当作零。
console.log({ totals, transportWallMs, runWallMs, complete })
```

适配器还支持 `onUsage: usage => hostMetrics.record(usage)`，用于记录已收到响应的用量，包括被拒绝或截断的回答。观察回调异常不改变绘图行为。取消后的迟到响应仍可送到宿主观察器，但不会改写运行器已返回的测量快照。自定义传输可以使用 `/model-usage` 的 `extractKJModelUsage`。这些记录不包含回答文本、密钥、推算 token 或价格。真实模型对比仍需相同任务的重复实验与明确配置的模型服务。

## 运行包内示例 {#example}

```sh
node node_modules/@kanjieteam/kjdraw/examples/model-agent.mjs
```

默认离线运行，演示四种消息格式、宿主批准、保存后的图元与撤销，不连接模型。

要连接在线模型，在可信服务端或命令行环境配置 `KJDRAW_MODEL_PROTOCOL`、`KJDRAW_MODEL_NAME`、`KJDRAW_MODEL_ENDPOINT` 与 `KJDRAW_MODEL_API_KEY`，再加 `--live`。地址填写完整的可信 REST 接口。示例拒绝重定向和 URL 凭据、限制响应大小，也不会自动应用在线提案。每次运行最多发送四次模型请求和八次工具调用；在线请求可能产生费用。

## 扩展与验证 {#extend}

实现 `KJAgentModel.createConversation({ instructions, tools })`，返回 `next(input, signal)`。每轮返回 `text` 和 `calls`；调用包含 `id`、`name`、`arguments`。输入是初始需求或有序工具结果。厂商会话数据留在自己的会话对象中，保留调用与结果的 ID。已有 Agent 运行时也可以直接使用 `KJAgentToolSession`，自行管理执行循环。

适配器保留 Responses 推理条目、Chat 推理字段、Claude 签名思考块和 Gemini 思考签名，不会将这些字段放进公开回复。截断、拦截、结构损坏或尚未支持的响应会在工具执行前停止；参数校验错误可以反馈给模型，在预算内修正。超时不能强制停止忽略取消信号的远端请求，宿主仍须限制网络资源和费用。

协议资料：[OpenAI 工具调用](https://developers.openai.com/api/docs/guides/function-calling)、[DeepSeek 工具调用](https://api-docs.deepseek.com/guides/tool_calls/)、[Claude 工具结果](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)、[Gemini GenerateContent](https://ai.google.dev/api/generate-content)。
:::
