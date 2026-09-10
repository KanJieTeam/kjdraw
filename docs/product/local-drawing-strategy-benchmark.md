# Local drawing strategy benchmark

This benchmark measures a working CAD capability: combining drawing entities into reviewed, undoable proposals. It compares two strategies **inside the same KJDraw core**. It does not rank AI models or compare KJDraw with another CAD product.

Run from the repository root with Node 22 or newer:

```sh
node scripts/benchmarks/drawing-strategies.mjs --output=.cache/drawing-strategies-run --repetitions=5
```

Choose a new output directory each time. Existing results are never overwritten. The script makes no model or other network requests. It reuses the three original tasks from the earlier model pilot and adds a fixed 209-entity perforated panel. Both strategies receive the same complete requirements and geometry; no random seeds or successful outputs are selected after execution.

| Arm | Actual operation |
| --- | --- |
| `per-entity` | One `cad_propose_drawing` call and synthetic host approval per entity |
| `batched-64` | The same tool and approval path, grouping up to 64 entities per proposal |

Each arm starts one session per proposal. This respects existing proposal limits and keeps the session policy the same. Batching changes transaction and undo granularity, so a faster result can come from amortizing proposal validation, document/history work and approval overhead. It is not evidence of faster model inference.

After one warmup per task/arm, measured execution order alternates across at least five repetitions. Every run records construction and total elapsed time, tool-call count, UTF-8 JSON call-envelope bytes, geometry checks and hashes. Byte counts exclude model instructions, tool schemas, conversation history and provider framing. **Bytes are not tokens.** The report leaves actual model token counts, cached tokens, inference latency and cost `null`.

Geometry checks compare actual entities against the task's expected lines, circles, counterclockwise arcs and straight polyline edges, rounded to six decimal places in millimeters. They also check units, model-space ownership, missing/extra geometry, KJD and DXF save/reopen, undo and redo. The reopen path uses KJDraw; this run does not claim independent CAD-reader acceptance or production engineering validity. These checks can show parity between strategies; when both pass, the chart shows the same result instead of claiming an unsupported quality advantage.

The output directory contains:

- `report.json`: source commit when available, dirty state, SDK/script hashes, machine/runtime, requirements, each measured run, failures and medians.
- `tool-payload.svg`, `local-time.svg`, `geometry-correctness.svg`: three charts with visible measurement boundaries.
- Representative editable KJD/DXF, actual-output SVG previews and exact tool-call traces from repetition 1 of every task/arm. All repetitions keep their checks and trace hashes in the report.

Construction timing includes proposal generation and synthetic approval. Total timing also includes document creation, checking, in-memory serialization/reopening and undo/redo; artifact filesystem writes are excluded. Timings describe this local machine and run, with no isolated-machine or cross-hardware guarantee. Failed measured runs remain in the report; a run without usable timing suppresses comparative charts rather than silently discarding that failure.

Public charts and drawings may be committed from a reviewed run because every fixture is original and synthetic. Use the report and matching files together. Real “tokens saved,” “model time saved,” or “quality improved” charts require a separate paired live-model experiment with the same model/settings/tasks, repeated attempts, provider usage, cached-token accounting, failures, cost and independent geometry validation. The existing [live pilot](../../scripts/benchmarks/deepseek-drawing-pilot.py) is a starting point; its three one-shot tasks do not establish general performance or complete complex-drawing delivery.

## Recorded run: 2026-09-10

The [raw report](../benchmarks/local-drawing-strategies-2026-09-10/report.json) records 40/40 passing measured runs, five repetitions per task/arm, plus eight passing warmups. Source content hashes matched before and after the run. The recorded Git base was `6b9bb6f` with uncommitted source changes, identified by the report's full SDK and benchmark-script hashes; this is not a released-package result.

| Task | Per-entity → batched call JSON | Per-entity → batched local build median | Geometry / persistence |
| --- | --- | --- | --- |
| Mounting plate | 1,693 → 618 bytes | 28.79 → 4.91 ms | Both 5/5 |
| Bolt flange | 1,524 → 586 bytes | 24.89 → 4.30 ms | Both 5/5 |
| Stepped profile | 771 → 368 bytes | 12.07 → 3.53 ms | Both 5/5 |
| 209-entity perforated panel | 37,224 → 9,443 bytes | 3,788.29 → 85.25 ms | Both 5/5 |

These values measure local transaction/proposal batching. They establish neither model token savings nor a model-speed or drawing-quality advantage.

- [Tool payload chart](../benchmarks/local-drawing-strategies-2026-09-10/tool-payload.svg)
- [Local timing chart](../benchmarks/local-drawing-strategies-2026-09-10/local-time.svg)
- [Geometry and persistence chart](../benchmarks/local-drawing-strategies-2026-09-10/geometry-correctness.svg)
- [Actual perforated-panel preview](../benchmarks/local-drawing-strategies-2026-09-10/perforated-panel-209-batched-64-1.svg), [editable KJD](../benchmarks/local-drawing-strategies-2026-09-10/perforated-panel-209-batched-64-1.kjd), [DXF](../benchmarks/local-drawing-strategies-2026-09-10/perforated-panel-209-batched-64-1.dxf)
