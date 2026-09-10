# Layout discovery acceptance — 2026-09-10

Status: incremental 1.0-rc.3 work. This does not close the complete 1.0 gates.

## Implemented behavior

`createLayoutContext` and the ninth model tool, `cad_read_layouts`, discover model, populated paper and empty paper layouts at a specified document revision. Each entry carries the exact layout and owner-space IDs, name, model/active flags, tab order and numeric DXF page settings. A caller can then pass the discovered owner ID to `cad_query_drawing` to inspect that sheet's actual entities without supplying IDs out of band.

The result is immutable and read-only. Pagination enforces 1–100 layouts and 1–256 KiB of UTF-8 context JSON, with defaults of 20 and 16 KiB in the public API. Continuations require the same revision. Over-budget names/settings have explicit omission markers; exact identities are never shortened, and impossible identity budgets reject. The budget excludes tool and protocol wrappers and does not bound the initial snapshot allocation or catalog scan time.

Numeric fields follow the existing DXF contract: physical paper, margins and origin offsets are millimeters; rotation is a quarter-turn index, while plot-window coordinates use drawing units. Printer, paper, setup, view and style resource names, native output preferences and custom payloads do not enter this tool output. Layout names remain untrusted drawing data. Output omissions are not inferred geometry or authorization.

## Actual validation

- Node 22 and Node 24: **406/406 each**, including packaged JavaScript/TypeScript/framework consumers and generated-runtime consistency.
- Four new native tests cover model/empty/populated layouts, exact paper-only queries, resource exclusion, immutability, no document/history changes, UTF-8 pagination with long Chinese names, stale and invalid requests, page edits, undo/redo and DXF reopening.
- Four protocol tests run layout discovery followed by a query of the returned owner space through Responses, Chat Completions, Anthropic Messages and Gemini Generate Content adapters. These are offline protocol fixtures exercising the actual tool dispatcher and CAD document, not live-model success measurements.
- Chromium, Firefox and WebKit: **27 accepted cases** across page settings, agent queries and bilingual docs. The first run passed 24 and failed the three guide-table assertions still expecting eight tools. After updating the assertion to nine and adding layout-tool display/search checks, those three cases passed. No SDK or generated guide changes were made between runs. Browser tests inspect saved sheets through the public editor, apply page changes, reopen DXF and query the returned paper-space owner.
- Strict TypeScript, 67 generated modules/declarations, API/guide generation and repository checks pass. The installed TypeScript consumer imports both layout context and tool argument types.

## Remaining scope

This tool does not project model geometry through paper viewports, expose raw resource paths, propose page edits, print or preview output. Long names/settings can be omitted; callers needing them must increase the budget or use trusted host APIs. Complex live-model tasks, paired token/cache/cost measurements, full viewport classification and the other 1.0 gates remain open. No stable tag or npm release was made.
