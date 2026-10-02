# Acceptance boundaries

Public synthetic fixture only: a blank millimeter document, explicit title facts, the bundled original template/rules and one explicitly placed revision triangle. No model transport, private input or API key is used.

The source test is `tests/community-sheet-template.spec.mjs`, run from the repository root. It exercises the existing public `KJAgentToolSession` and SDK, not a mock replacement engine. Its approval actor is a deterministic test host, never proof of real user approval.

## Observable checks

- The read-only planner consumes template dimensions, title fields, grid lines, layer rules and symbol vertices. Changing resource margin, layer/color or symbol vertices changes the approved native output and resource digests.
- Before approval, serialized drawing, history and DXF bytes are unchanged; preview contains 15 native entities and a pending AI command cannot execute.
- Test-host approval commits one CREATEBATCH transaction. Verify a closed frame at `[10,10]` through `[287,200]`, 5 title-grid lines, 8 exact title/label texts, one closed triangle and four dedicated layers.
- Undo restores original geometry and resource tables; redo preserves committed entity identities. Independently reopening DXF preserves geometry/layer meaning, not IDs or history.
- Mismatched session/document binding cannot register a proposal. A stale host approval, missing host identity or explicit rejection cannot insert the sheet or alter current geometry/history.
- Explicit dimensions/origin move the geometry without scaling or inferred facts. A scale label is text only.

## Refusal checks

Missing/unsupported units, mismatched document units, stale revision, nonfinite/overflow coordinates, undersized dimensions, missing/unknown fields, controls or overflowing text, unsupported/outside/overlapping symbols, unknown input flags, existing geometry, layer-name collision, invalid native resource values and an oversized title block fail without a mutation or registered plan.

## Limits

The template is an original example, not a certified drafting standard. No paper layout, viewport, font-metric verification, engineering calculation, regulatory meaning, external CAD-host interoperability matrix or real-model acceptance is claimed. Resources are parsed data; receipts hash their `JSON.stringify` representation. A host must bind session and document correctly, review the native preview, obtain actual user approval and choose a new export destination.
