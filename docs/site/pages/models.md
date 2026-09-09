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

| Connection | Adapter value | Host transport |
| --- | --- | --- |
| OpenAI Responses | `responses` | Responses REST endpoint |
| Chat Completions-compatible services | `chat-completions` | The selected service's compatible endpoint; DeepSeek is one evaluation option |
| Claude Messages | `anthropic-messages` | Messages REST endpoint |
| Gemini GenerateContent | `gemini-generate-content` | GenerateContent REST endpoint, with model in the URL |
| Your framework, gateway or local model | Custom `KJAgentModel` | Your own conversation bridge |

These adapters are implemented and tested against protocol fixtures and real CAD operations. That is not a claim that every model, vendor extension or live endpoint has been tested. Native function calling must be supported by the selected model. For text-only models, a custom bridge can parse and validate a structured response; never execute model-generated JavaScript.

## Wire the model once {#quickstart}

Available in the current source checkout. Check that your installed package contains `model-adapters` and `agent-runner` before using these entries.

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
  maxTurns: 8,
  maxToolCalls: 32,
})
```

`selectedModel` and `hostModelGateway` belong to your application. The gateway returns parsed, non-streaming provider JSON and rejects HTTP failures. For Gemini, send the body to the configured model URL; this is a REST adapter, not the Google SDK's nested `config` argument. Keep keys, endpoint allowlists and user permissions on your server. The CAD package does not discover keys, choose an endpoint or send network requests by itself.

Chat-compatible endpoints differ in output token fields: the default is `max_tokens`; set `chatTokenParameter: 'max_completion_tokens'` when required. The other adapters map `maxOutputTokens` to their protocol. Full runtime argument validation remains enabled; Responses explicitly uses non-strict tool generation rather than promising identical provider-side schema support.

## Review the result {#review}

| Status | What the host should do |
| --- | --- |
| `awaiting-approval` | Display the exact proposals in `outputs`; use `proposalIds` to approve or reject from your review UI |
| `responded` | Show the model's answer or clarification; it is not evidence that a drawing task succeeded |
| `limit-reached` | Inspect results and adjust the task or budget; do not automatically retry forever |
| `cancelled` | The host cancelled or the run timed out; late model calls are not dispatched |
| `failed` | Handle the structured error; inspect private transport diagnostics on the server |

The runner stops when it has proposals. It never calls `approve()`. After an authenticated user reviews the exact arguments, your host calls `session.approve(planId, user.id)` or `session.reject(planId, user.id)` and checks the result. Model text must be displayed as untrusted text, not unsanitized HTML.

Each run starts a fresh model conversation. After applying a proposal, start a new run with the next user request and let it read the current drawing. This version does not provide durable conversation resume, automatic file saving, rendered previews for every tool or a built-in MCP server. See [Agent workflows](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) for the available CAD tools and geometric review API.

## Run the packaged example {#example}

```sh
node node_modules/@kanjieteam/kjdraw/examples/model-agent.mjs
```

The default is offline: it tests all four wire formats, simulated host approval, saved geometry and undo. It makes no model calls.

For a live proposal-only check, configure `KJDRAW_MODEL_PROTOCOL`, `KJDRAW_MODEL_NAME`, `KJDRAW_MODEL_ENDPOINT` and `KJDRAW_MODEL_API_KEY` in a trusted server/CLI environment, then add `--live`. The endpoint is the complete trusted REST URL. The example rejects redirects and URL credentials, limits response bytes and never applies live proposals automatically. It uses a synthetic circle request, at most four model requests and eight tools; live calls can incur provider charges. DeepSeek may be used for low-cost evaluation; it is not a dependency or default model.

## Extend and validate {#extend}

Implement `KJAgentModel.createConversation({ instructions, tools })` and return `next(input, signal)`. A turn returns `text` plus `calls` containing `id`, `name` and `arguments`. Inputs are either the initial prompt or ordered tool results. Keep vendor continuation data private to that conversation and preserve call/result IDs. Existing harnesses can also use `KJAgentToolSession` directly and retain their own loop.

Adapters retain Responses reasoning items, chat reasoning fields, Claude signed thinking blocks and Gemini thought signatures in their original conversation. They do not place those fields in the public answer. Truncated, blocked, malformed or unsupported responses stop before tool dispatch. Tool validation errors can be returned to the model for bounded correction. Timeouts cannot stop a transport that ignores its signal from consuming remote resources; the host must enforce its own network and billing limits.

Protocol references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls/), [Claude tool results](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [Gemini GenerateContent](https://ai.google.dev/api/generate-content).
:::
:::zh
## 选择接入方式 {#connection}

KJDraw 不依赖特定 AI 厂商。选择协议适配器，传入模型和宿主请求函数，就能使用同一套 CAD 工具。其他框架、本地模型或协议可实现 `KJAgentModel`，无需修改绘图引擎。

| 接入方式 | 适配器值 | 宿主请求目标 |
| --- | --- | --- |
| OpenAI Responses | `responses` | Responses REST 接口 |
| Chat Completions 兼容服务 | `chat-completions` | 所选服务的兼容接口；DeepSeek 只是测试选项之一 |
| Claude Messages | `anthropic-messages` | Messages REST 接口 |
| Gemini GenerateContent | `gemini-generate-content` | GenerateContent REST 接口，模型名放在 URL 中 |
| 自有框架、网关、本地模型 | 自定义 `KJAgentModel` | 你的会话桥接实现 |

这些适配器已通过协议样例与真实 CAD 操作测试，但不代表所有模型、扩展字段和在线服务都已实测。所选模型需要支持工具调用；纯文本模型可通过自定义桥接解析并校验结构化结果，不能执行模型输出的 JavaScript。

## 配置一次模型连接 {#quickstart}

以下入口已加入当前源码；使用前确认安装包包含 `model-adapters` 与 `agent-runner`。

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
  maxTurns: 8,
  maxToolCalls: 32,
})
```

`selectedModel` 与 `hostModelGateway` 由应用提供。网关返回解析后的非流式模型 JSON，HTTP 失败时抛错。Gemini 适配器使用 REST 请求体，不是 Google SDK 的嵌套 `config` 参数。密钥、接口白名单和用户权限放在服务端；CAD 包不会搜索密钥、选择地址或自行联网。

兼容接口的输出 token 字段并不完全相同：默认使用 `max_tokens`，需要时设置 `chatTokenParameter: 'max_completion_tokens'`；其他适配器按各自协议映射 `maxOutputTokens`。所有工具参数仍由运行时严格校验；Responses 显式使用非 strict 生成模式，不假设各厂商的服务端 Schema 支持完全一致。

## 处理运行结果 {#review}

| 状态 | 宿主应该做什么 |
| --- | --- |
| `awaiting-approval` | 展示 `outputs` 中的确切修改，用 `proposalIds` 在审核界面批准或拒绝 |
| `responded` | 展示模型回答或澄清问题；这不证明绘图任务已成功 |
| `limit-reached` | 检查结果并调整任务或预算，不无限自动重试 |
| `cancelled` | 用户取消或运行超时；迟到的模型调用不会再执行 |
| `failed` | 处理结构化错误，在服务端检查私有请求日志 |

一旦得到提案，运行器就停止，不会调用 `approve()`。经过认证的用户审核后，宿主再调用 `session.approve(planId, user.id)` 或 `session.reject(planId, user.id)`，并核对结果。模型回复应当作为不可信文字展示，不能直接当作 HTML 渲染。

每次运行新建模型会话。应用修改后，用用户的新需求再次运行，让模型重新读取当前图纸。这一版不包含持久会话恢复、自动保存、全部工具的几何预览或内置 MCP 服务。可用绘图工具与几何审核接口见 [Agent 工作流](https://kanjieteam.github.io/kjdraw/docs/latest/agent/)。

## 运行包内示例 {#example}

```sh
node node_modules/@kanjieteam/kjdraw/examples/model-agent.mjs
```

默认离线运行，检查四种消息格式、模拟宿主批准、保存后的图元与撤销，不调用模型。

要执行在线提案测试，在可信服务端或命令行环境配置 `KJDRAW_MODEL_PROTOCOL`、`KJDRAW_MODEL_NAME`、`KJDRAW_MODEL_ENDPOINT` 与 `KJDRAW_MODEL_API_KEY`，再加 `--live`。地址填写完整的可信 REST 接口。示例拒绝重定向和 URL 凭据、限制响应大小，不会自动应用在线提案。测试使用合成圆形需求，最多四次模型请求、八次工具调用；在线请求可能产生费用。DeepSeek 可用于低成本测试，但不是架构依赖或默认模型。

## 扩展与验证 {#extend}

实现 `KJAgentModel.createConversation({ instructions, tools })`，返回 `next(input, signal)`。每轮返回 `text` 和 `calls`；调用包含 `id`、`name`、`arguments`。输入是初始需求或有序工具结果。厂商会话数据留在自己的会话对象中，保留调用与结果的 ID。已有 harness 也可以直接使用 `KJAgentToolSession`，继续管理自己的循环。

适配器保留 Responses 推理条目、Chat 推理字段、Claude 签名思考块和 Gemini 思考签名，不会将这些字段放进公开回复。截断、拦截、结构损坏或尚未支持的响应会在工具执行前停止；参数校验错误可以反馈给模型，在预算内修正。超时不能强制停止忽略取消信号的远端请求，宿主仍须限制网络资源和费用。

协议资料：[OpenAI 工具调用](https://developers.openai.com/api/docs/guides/function-calling)、[DeepSeek 工具调用](https://api-docs.deepseek.com/guides/tool_calls/)、[Claude 工具结果](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)、[Gemini GenerateContent](https://ai.google.dev/api/generate-content)。
:::
