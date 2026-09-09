# Multi-model integration acceptance

Date: 2026-09-09. Evidence applies to the source commit containing this record, not an npm release or a live model evaluation.

## Architecture delivered

- One model-independent CAD tool session. No vendor SDK, endpoint, key lookup or fixed model name in the CAD core.
- Four non-streaming protocol adapters: Responses, Chat Completions-compatible, Claude Messages and Gemini GenerateContent.
- `KJAgentModel` / `KJModelConversation` for custom protocols, local models and framework/harness bridges. A framework may also call the existing tool session directly.
- A bounded runner with turn/call/timeout limits, cancellation, duplicate-call rejection, structured errors and host-only approval. It stops at proposals, never applies them automatically and does not execute generated code.
- Continuation preserves protocol call IDs and provider reasoning/signature data without exposing those fields as user-visible answers.
- A packaged offline example, plus an explicit `--live` proposal-only path with host-selected model/endpoint, server-side credentials, bounded HTTP responses and redirect rejection.
- English/Chinese model integration guides. Root English/Chinese README introductions and the npm README now use the user-approved CAD infrastructure wording.

## Accepted locally

| Check | Result |
| --- | --- |
| Full SDK and packed consumers, Node 22 | 329 passed; zero failures |
| Full SDK and packed consumers, Node 24 | 329 passed; zero failures |
| New protocol/runner tests | 17 passed |
| Chromium, Firefox, WebKit documentation | 15 passed, including both languages, 390px layout, search and existing deep links |
| Strict types, generated runtime/declarations, generated API/guide drift and repository checks | Passed |

All four protocol fixtures run the same sequence against the actual CAD engine: read units, reject a unit mismatch, submit corrected circle arguments, stop for review, simulate host approval, verify geometry, save/reopen KJD and undo. Other tests cover truncated outputs, malformed JSON, signed continuation, missing Gemini call IDs, custom bridges, budgets, cancellation, late responses and transport-error redaction.

## Not established by this batch

No live provider calls, paid-model spending, npm publication or release tags were performed. Fixture acceptance proves the tested protocol mapping and CAD behavior, not endpoint availability or model reasoning quality. DeepSeek is an optional economical test target; it is not a dependency or a universal-model proxy.

Streaming, durable conversational resume, provider-specific SDK convenience wrappers, an MCP server and full mechanical-task acceptance remain open. Native tool calling depends on the selected model. Text-only models need a separate structured-response bridge and the same runtime validation.

Next: use host-authorized live configurations against a versioned task corpus, recording protocol, exact model/configuration, geometric results, intervention, latency and cost. Expand task-sized CAD operations and geometry review alongside that evaluation. Keep unsupported configurations explicit instead of treating “compatible endpoint” as “every model certified.”

Implementation references, checked 2026-09-09: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [DeepSeek tools](https://api-docs.deepseek.com/guides/tool_calls/), [DeepSeek continuation](https://api-docs.deepseek.com/guides/thinking_mode/), [Claude tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [Gemini REST](https://ai.google.dev/api/generate-content). OpenAI Docs guidance informed the Responses continuation and explicit schema-mode handling.
