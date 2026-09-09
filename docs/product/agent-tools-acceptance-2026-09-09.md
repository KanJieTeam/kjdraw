# Model-neutral starter tools — acceptance record

Date: 2026-09-09. This record describes the source changes in the commit containing this file, not a published npm version or a real-model evaluation.

## Delivered

- Public TypeScript `KJAgentToolSession` and `@kanjieteam/kjdraw/agent-tools` entry point, with generated JavaScript and declarations.
- Six serializable tools: drawing read, revision-bound pagination, point distance, line/circle proposals and bounded LINE/CIRCLE movement proposals.
- One authorized document per session, input/unit/revision validation, host-only approval/rejection, existing one-shot plan binding and no automatic mutation replay.
- Installed-package example covering proposal, simulated approval, duplicate rejection, actual native geometry, KJD reopen and undo. No model request or API key is involved.
- English/Chinese guide, searchable API reference and packed JavaScript/TypeScript consumer verification.
- Read-only `audit:distribution` command distinguishing source version, public channel and unavailable registry responses. It does not publish, change tags or verify artifact integrity.

## Verification

| Check | Result |
| --- | --- |
| Complete SDK suite, Node 22 | 312 passed, zero failures; includes isolated packed consumers |
| Complete SDK suite, Node 24 | 312 passed, zero failures; includes isolated packed consumers |
| New tool session tests | 12 passed, including stale/expired plans, locked objects, detached documents and duplicate/concurrent approval |
| Distribution audit tests | 6 passed with fixture responses and simulated outages |
| Documentation, Chromium/Firefox/WebKit | 12 passed, including 390px viewport, languages, search and old deep links |
| Type checking and generated API/guide checks | Passed |

Browser acceptance found that the guide index stripped underscores from inline tool names. The generator now preserves inline code identifiers; searching `cad_propose_circles` reaches its guide in both languages. The test initially used an incorrect heading ID; it now follows the generator's locale/page/section convention.

The earlier Firefox subpixel assertion fix at `242561a` passed [complete cloud CI](https://github.com/KanJieTeam/kjdraw/actions/runs/34316740217). That result is not cloud CI evidence for the later tool commit; inspect its own exact-SHA run after pushing.

## Remaining work

This is not a DeepSeek/OpenAI/Anthropic adapter, MCP server or general natural-language design loop. Creation is model XY at z=0; movement is limited to visible editable model-space LINE/CIRCLE objects. Proposals expose command arguments, not a new rendered geometry preview. The host owns authentication, model-data disclosure, budgets, persistence and recovery.

No npm publication or release tag was performed for this batch. The local Node registry request failed, so that audit run reported unknown; fixture tests must not be presented as a live registry success. The dated registry observation and source-install instructions remain in [publishing guidance](../npm-publishing.md).

Next acceptance: a real host-selected model creates and revises a dimensioned part, with geometry review, rejection, numeric checks, save/reopen and bounded failure handling. Track it in W07–W09 of the [master programme](roadmap-to-core.md), alongside the unfinished CAD construction/editing workstreams.
