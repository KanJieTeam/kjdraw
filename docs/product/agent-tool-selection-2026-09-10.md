# Task-specific agent tool selection

Date: 2026-09-10. Source increment after local hatch commit `0227895`; accepted source is the commit containing this record. Publication remains pending.

`runKJAgentTask({ toolNames })` now lets a trusted host select the tools needed for a run. Previously every conversation received all seven schemas. Omission preserves that default; an explicit list must contain unique, known names and at least one tool. Selection retains canonical definition order and complete unit/argument schemas. The runner snapshots the selection before invoking model code and rejects an entire batch containing an omitted tool before any tool dispatch. It returns `KJAGENT_TOOL_NOT_ALLOWED`; caller-array or bridge mutation cannot widen permissions. Direct trusted session calls and subsequent runs retain their own authority. This is not authentication and never grants model approval.

Validation:

- Node 22/24 full suites: **382/382 each**, including packed JS/TS/React/Vue consumers and the packaged model example, now using two selected tools.
- Chrome 152, Firefox 155 and WebKit 26.6: **21/21** Agent geometry/editor and bilingual documentation tests. The editor integration exercises omitted-tool rejection, a selected mixed-geometry proposal, host approval, selection, undo/redo and exact restored geometry; existing temporary-overlay pixel checks remain active.
- **31/31** model-adapter tests include all four protocols with selected definitions, read, invalid-unit correction, proposal, trusted approval, exact saved/reopened circle geometry, undo/redo, omitted-call whole-batch refusal, invalid/sparse/duplicate options and caller/bridge mutation. Existing default behavior, cancellation, timeout, replay and custom-model tests remain active.
- Strict TypeScript and generated runtime/declaration/API/bilingual documentation checks pass. The current implementation introduces no vendor SDK or network transport dependency.

Run `node scripts/benchmarks/agent-tool-selection.mjs` to reproduce the offline wire-byte comparison. Both variants execute the same three-turn synthetic read → invalid units → corrected proposal sequence, then validate host approval, DXF reopen and undo/redo. The host applies the proposal only after the runner stops. The script makes no HTTP requests and is included in CI.

| Protocol | Full / selected schema bytes per request | Full / selected total bytes across three requests |
| --- | --- | --- |
| Responses | 8,156 / 1,431 | 28,745 / 8,570 |
| Chat Completions | 8,142 / 1,427 | 28,739 / 8,594 |
| Messages | 7,939 / 1,369 | 28,098 / 8,388 |
| GenerateContent | 8,022 / 1,412 | 28,326 / 8,496 |

These are UTF-8 JSON bytes of actual adapter request bodies, **not provider tokens, billed costs, inference timing or real-model success rates**. Per-turn tool-result sizes remain 457 / 107 / 757 bytes in both variants; context and history were not removed to manufacture schema savings. Protocol wrapper bytes differ. First non-tool request bytes and later history bytes are retained in script output. This small fixture verifies selection mechanics, not complex-task competence or automatic tool discovery.

Still open: viewport-aware context queries, larger multistep paired live-model cases, actual input/output/cache token accounting, repeated runs and the 30-task retained evaluation set. The four protocol fixtures do not establish four live provider configurations. No private source drawings or credentials enter this benchmark. Stable 1.0, npm publication and all broad W07/W08/W11 gates remain pending.
