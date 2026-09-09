# Browser loading comparison protocol

This opt-in diagnostic compares the current KJDraw checkout with pinned open-source packages, using drawings supplied by the operator. It does not run in CI, upload drawings, or establish a public performance ranking.

## What is compared

- [dxf-viewer](https://github.com/vagran/dxf-viewer), tested package **1.0.48**: a WebGL viewing scene. The diagnostic uses its public `Load` API without a worker.
- [dxf-parser](https://github.com/gdsestimating/dxf-parser), tested package **1.1.2**: a JavaScript parsing baseline, not a viewer or editor. Report missing entity categories beside timing.
- KJDraw: DXF import into an editable document, followed by the packaged Canvas renderer. Import includes model, block and paper-space records; displayed content is model space.

These workloads are not equivalent. In particular, a parse-only result cannot be presented as time to a usable CAD editor. The third-party packages are isolated benchmark dependencies; they are not added to the production SDK.

## Run locally

Install repository development dependencies first. In a separate, disposable dependency directory install:

```sh
npm install --ignore-scripts --save-exact dxf-viewer@1.0.48 dxf-parser@1.1.2
```

Prepare a private JSON manifest containing 1–30 unique IDs and absolute paths to **modern UTF-8 ASCII DXF** files, each no larger than 32 MiB:

```json
[
  { "id": "drawing-01", "path": "/absolute/private/path/drawing.dxf" }
]
```

Set these environment variables in your shell:

| Variable | Value |
| --- | --- |
| `KJDRAW_COMPARE_MANIFEST` | Absolute manifest path |
| `KJDRAW_COMPARE_DEPS` | Directory containing the isolated `node_modules` |
| `KJDRAW_COMPARE_FONT` | Absolute path to a locally licensed TTF font covering drawing characters |
| `KJDRAW_COMPARE_OUTPUT` | New private output directory |
| `KJDRAW_COMPARE_REPEATS` | 3 by default; 1–10 allowed |
| `KJDRAW_CHROME_PATH` | Optional Chrome executable; otherwise Playwright Chromium |

From the repository root:

```sh
node scripts/benchmarks/browser-load-comparison.mjs
```

The runner binds a temporary HTTP server to loopback only, serves an explicit file allowlist, blocks non-local browser HTTP requests, and closes the browser/server afterward. Source drawings are read, never overwritten. Keep the manifest, screenshots and `report.private.json` out of public repositories. Screenshots may contain project identities, coordinates or proprietary geometry. A checksum is an integrity marker, not anonymization or permission to redistribute.

## Measurement boundaries

- Fixed 1280 × 800 viewport and device scale 1; browser, GPU, CPU, versions and bundle digest are recorded.
- Fresh browser context per run, shared browser process. Dependency code, local file bytes and the supplied font are loaded before timing. This is **not cold navigation or network-download performance**.
- Both renderers run on the main thread in this first protocol. It does not measure the worker-enabled responsiveness available in other configurations.
- Engine setup is excluded. `apiLoadMs` covers each public loading path through its returned initial render. `scheduledFrameMs` additionally waits for two animation-frame callbacks; it is not proof of GPU completion or correct display.
- KJDraw's `parseAndDocumentMs` includes editable state construction. `dxf-parser`'s `parseOnlyMs` does not. Keep them in separate columns.
- The supplied font bytes are shared, but browser-native text and vector-glyph rendering do not necessarily match. Geometry, styles, layouts, warnings and screenshots require a separate fidelity review.
- `redrawCpuMs` measures calls on the CPU, not frame rate or GPU execution. Do not use it as an FPS comparison.
- Three repeats support exploratory medians and ranges, not trustworthy p95 estimates. Order alternates to reduce, not eliminate, order bias. Do not run unrelated heavy workloads concurrently.

Review `renderReport.unsupported`, approximate types, missing-glyph flags, warnings and model-space entity counts. Missing HATCH entities, layouts, text or geometry disqualify a "faster correct drawing" claim even if the API returns quickly. Entity counts alone do not prove geometric correctness.

## Next acceptance gates

1. **Fidelity first:** independently inspect source and output; verify geometry, Unicode, layers, blocks, paper layouts and units. Establish a trusted visual reference, not one competitor's rendering as automatic ground truth.
2. **Import cost:** profile tokenization, handle/reference resolution, state construction, validation and first rendering separately. Avoid repeated whole-document scans while retaining validation and rollback.
3. **Responsiveness:** compare worker-backed loading, first useful view, complete load, selection, pan/zoom and an actual edit at equivalent quality settings. Record main-thread long tasks and cancellation.
4. **Incremental editing:** change a bounded working set without cloning/rebuilding an entire large drawing; verify unaffected objects, approval bindings, undo and export.
5. **Reproducibility:** add licensed public drawings, geometric/text/layout oracles, more repetitions, cold/warm runs and lower-end hardware before any public speed claim.

Fast viewing, fast editing and faster successful AI tasks are related but distinct benchmarks. This diagnostic does not measure model latency, tokens or engineering correctness.
