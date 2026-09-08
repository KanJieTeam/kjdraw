---
slug: agent
title.en: Agent workflows
title.zh: Agent 工作流
summary.en: Turn model output into an immutable proposal that a human can inspect before one atomic drawing transaction executes.
summary.zh: 把模型输出变成不可变提案，让人工检查后再执行一次原子图档事务。
---
:::en
## Review before mutation {#review-before-mutation}

```text
Intent → plan envelope → exact preview → human approval
       → verified one-shot execution → receipt → undo
```

An AI-origin command cannot mutate a document unless its exact proposal has first been registered, reviewed and confirmed. The SDK binds the plan to command arguments, document identity, full document digest, fingerprint, expected revision and expiry.

## Plan and execute {#plan-and-execute}

```ts
const plan = sdk.createCommandEnvelope('MOVE', {
  ids: selectedIds,
  dx: 5,
  dy: 0,
}, {
  mode: 'plan',
  origin: 'ai',
  expectedRevision: drawing.revision,
})

const preview = await sdk.executeCommandEnvelope(plan)
// Render preview.result, then collect explicit approval.

const execution = sdk.createCommandEnvelope(plan.command, plan.arguments, {
  origin: 'ai',
  expectedRevision: plan.expectedRevision,
  confirmation: {
    status: 'confirmed',
    planId: plan.id,
    confirmedBy: currentUser.id,
  },
})

const receipt = await sdk.executeCommandEnvelope(execution)
```

## Fail-closed cases {#fail-closed-cases}

- Missing, rejected, expired or already consumed plan.
- Changed arguments, target document or expected revision.
- Document drift after the preview was created.
- Missing reviewer identity or replay of a successful execution envelope.

## Security boundary {#security-boundary}

This is an application protocol inside one SDK host process. It does not authenticate users, sandbox a model, enforce organization policy across services or persist a durable approval ledger. The host owns those controls and may store the returned receipt as audit evidence.

Start with the stable [Agent integration contract](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent.md), then use the maintained [Agent protocol](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent-protocol.md) for the complete lifecycle and boundary.
:::
:::zh
## 修改前先审核 {#review-before-mutation}

```text
意图 → 计划信封 → 精确预览 → 人工批准
     → 校验后一次性执行 → 回执 → 撤销
```

AI 来源命令必须先完成精确提案的注册、审核和确认，才能修改图档。SDK 会把计划绑定到命令参数、图档身份、完整内容摘要、指纹、预期修订号和有效期。

## 计划与执行 {#plan-and-execute}

```ts
const plan = sdk.createCommandEnvelope('MOVE', {
  ids: selectedIds,
  dx: 5,
  dy: 0,
}, {
  mode: 'plan',
  origin: 'ai',
  expectedRevision: drawing.revision,
})

const preview = await sdk.executeCommandEnvelope(plan)
// 渲染 preview.result，然后收集明确批准。

const execution = sdk.createCommandEnvelope(plan.command, plan.arguments, {
  origin: 'ai',
  expectedRevision: plan.expectedRevision,
  confirmation: {
    status: 'confirmed',
    planId: plan.id,
    confirmedBy: currentUser.id,
  },
})

const receipt = await sdk.executeCommandEnvelope(execution)
```

## 关闭执行的情况 {#fail-closed-cases}

- 计划缺失、被拒绝、已过期或已消费。
- 参数、目标图档或预期修订号发生变化。
- 生成预览后图档又发生漂移。
- 缺少审核人身份，或重放已经成功的执行信封。

## 安全边界 {#security-boundary}

这是单个 SDK 宿主进程内的应用协议。它不负责认证用户、隔离模型、跨服务执行组织策略，也不会替代持久批准账本。宿主负责这些控制，并可以保存返回回执作为审计证据。

Agent 开发者先阅读稳定的 [Agent 集成契约](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent.md)，完整生命周期和边界见持续维护的 [Agent 协议](https://github.com/KanJieTeam/kjdraw/blob/main/docs/agent-protocol.md)。
:::
