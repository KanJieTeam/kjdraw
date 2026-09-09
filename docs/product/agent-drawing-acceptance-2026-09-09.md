# Mixed Agent drawing acceptance — 2026-09-09

Status: locally accepted; Git publication does not publish a new npm version.

## Delivered

`cad_propose_drawing` composes lines, circles, counterclockwise arcs and straight-segment lightweight polylines into one reviewed proposal. The four groups share a 64-object maximum. Angles are explicitly degrees; closed polylines close without repeating their first vertex. Invalid geometry, units, unexpected fields and oversized groups fail before source edits.

The same detached preview, host approval and identity binding introduced in the previous increment are reused. MOVE now supports all four entity types. The tool is model-neutral: four protocol adapters pass the same mixed-input fixture; no separate CAD implementation exists per provider.

## Acceptance evidence

- Node 24: 340/340 full tests passed, including isolated npm install and typed consumers.
- Node 22: 340/340 full tests passed, including isolated npm install and typed consumers.
- Chromium / Firefox / WebKit: 21/21 preview, embedded-editor and bilingual documentation checks passed.
- Strict TypeScript, generated declarations/API/docs, repository checks and whitespace validation passed.
- Synthetic 120 × 60 mm mounting profile: four holes, two lines and two arcs making a rounded slot, and one closed contour; nine editable entities total.
- Preview leaves the source unchanged; approval commits all nine objects in one revision; KJD and DXF reopen preserve tested geometry; undo/redo operate on the batch.
- Moving the whole profile previews the exact resulting geometry; one undo restores the original payloads.
- Installed example: `node node_modules/@kanjieteam/kjdraw/examples/agent-drawing.mjs` (after installing an artifact containing this change).

## Remaining work

The tests above use deterministic inputs and offline provider responses, not measured language-model design success. The user's newly requested live-model comparison is a separate benchmark. Manufacturing tolerances, constraints, automatic dimensions, durable conversations, MCP and broader editing workflows are not completed by this increment.
