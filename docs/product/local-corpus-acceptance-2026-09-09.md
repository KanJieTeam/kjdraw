# Local drawings and loading diagnostics — 2026-09-09

## Accepted changes

- Modern DXF byte input uses UTF-8 despite stale legacy codepage headers. Invalid modern UTF-8 fails explicitly; legacy GBK input remains supported. The original GBK test incorrectly labelled its bytes as R2018 and now correctly uses R2004.
- TEXT/ATTRIB values and MTEXT chunks retain significant trailing spaces.
- DXF import tracks occupied handles instead of repeatedly traversing read-only object proxies. Transactions lazily index handles, update the index for generated objects and hard deletion, and retain duplicate rejection and rollback semantics.
- An opt-in [browser comparison runner and protocol](../benchmarks/browser-load-comparison.md) keep third-party benchmark dependencies outside the SDK and local drawings outside the public repository.

## Local corpus inspection

Six selected existing documents were tested, ranging from 121,423 to 3,782,490 bytes and from 191 to 9,029 entities including block/paper-space content. The selection contains a complete demonstration plan, a section sketch, a complex borehole template, generated plan/section acceptance fixtures, and a symbol library. It is not six independent industry projects or a representative random sample.

Original files, filenames, project text, geometry, detailed private reports and screenshots are not included here. Testing did not upload drawings, call a model, or modify source files. Before/after file hashes match for all six inputs.

Independent inspection used ezdxf 1.4.4. After the fixes:

- All six DXF outputs retain model-space and all-space entity-type counts, insertion units and the multiset of TEXT/MTEXT/ATTRIB/ATTDEF content.
- Four LINE-bearing documents complete a one-object move proposal, host approval, exact endpoint displacement, unaffected-entity check, undo and redo in detached test sessions.
- The larger template still fails Agent preflight because the serialized document exceeds the current 4 MiB limit. The symbol-library case has no LINE candidate and was not counted as a move success.
- **Two files lose a paper layout: three layouts become two.** Each output also requires an independent audit repair with code 109. One original input already needs other independent audit repairs; the other does not. Source and output findings are kept separate.
- Matching counts/text/units do not prove complete geometry, style, ownership, plotting or visual fidelity. The local corpus is not accepted as lossless or production-ready.

## Browser comparison

Two valid exploratory rounds used six identical local DXFs, three engines and three repeats per combination: 54 runs per round. The first valid round already included encoding/whitespace and importer-level handle tracking; the second additionally included the transaction handle index. An earlier harness trial used a wrong redraw method and is excluded from timing conclusions.

Final environment: Windows x64, Intel Core i9-13900HX, 32 logical processors, Chrome 152.0.7977.77, NVIDIA RTX 4050 Laptop GPU through ANGLE/D3D11, 1280 × 800, device scale 1. Dependencies: dxf-viewer 1.0.48 and dxf-parser 1.1.2. All 54 final calls returned; zero external browser requests were observed. This does not mean all drawings displayed correctly.

Final harness bundle SHA-256: `b81e485d54e16763bc35b28b92976a60685e237596e36cc208210ff97c003ca3`.

Times below are **median API load durations in milliseconds**, not cold page navigation, independently verified correct-display time, or time to an equivalent editor. Assets and font bytes are preloaded; KJDraw creates editable state, dxf-viewer creates a viewing scene, and dxf-parser only parses. Three repeats are insufficient for a robust p95. Fonts, styles and supported rendering differ; no overall winner is declared.

| Local case | KJDraw before transaction index | KJDraw after index | dxf-viewer, same final round | dxf-parser, parse only | KJDraw rendering finding |
| --- | ---: | ---: | ---: | ---: | --- |
| 01 Complete plan | 749.1 | 599.4 | 310.9 | 50.0 | No top-level unsupported entities; text/hatch approximations remain |
| 02 Section sketch | 1,060.4 | 558.5 | 302.1 | 20.9 | 77 HATCH objects not rendered |
| 03 Complex template | 8,511.5 | 2,269.5 | 346.3 | 78.4 | No top-level unsupported entities; approximations remain |
| 04 Generated plan fixture | 321.2 | 257.7 | 208.6 | 9.6 | No top-level unsupported entities; approximations remain |
| 05 Generated section fixture | 99.9 | 134.9 | 196.0 | 5.5 | 46 HATCH objects not rendered |
| 06 Symbol library | 121.3 | 157.6 | 232.6 | 8.4 | 60 HATCH objects not rendered |

The complex template's final KJDraw range was 2,013.9–2,566.0 ms; the initial valid round was 7,633.9–9,999.0 ms. Smaller workloads show noise/regressions between rounds, so the improvement is not generalized to all files. The larger file remains substantially slower to load than the viewing baseline.

dxf-parser omitted model-space HATCH categories in the five inputs containing them, so its very short timings do not establish complete CAD loading. The viewer also emitted warnings on some cases. KJDraw's shorter numbers in cases 05/06 are disqualified as performance wins because content is missing. Counts alone and successful API returns cannot establish visual equivalence. Private side-by-side inspection also shows styling/font differences.

## Verification

- Node 22 and Node 24 complete SDK suites: **349/349 each**, including package consumers, strict TypeScript-owned runtime/declaration consistency and existing editing/history coverage.
- Seven focused encoding/handle tests pass, including mixed duplicate/missing handles, 2,048-entity import, hard purge, soft deletion and rollback.
- Strict type checking, repository release checks and whitespace checks pass.
- Both private local roundtrip and browser performance reports retain failures and original file integrity checks. No paid model requests occurred in this increment.
- No new npm package or stable tag is published by this increment. These shared-core changes do not establish downstream application integration acceptance.

## Next implementation order

1. **P0 — File/visual correctness:** preserve empty/named layouts and correct ownership; cover the observed HATCH boundaries/patterns; verify text styling and block inheritance against independent references. Add redistributable synthetic regressions rather than publishing private source drawings.
2. **P1 — Large-document import:** profile remaining normalization, validation, history and scene construction; remove repeated scans without bypassing validation. Test mixed large files and malformed inputs, not only synthetic LINE throughput.
3. **P1 — Bounded Agent working sets:** prepare previews for the selected objects and required references rather than cloning the complete drawing. Retain stale-state protection, host approval and unchanged-object checks; do not simply raise the 4 MiB cap.
4. **P2 — Responsive viewing/editing:** workers, spatial queries and incremental scene updates; separately time first useful view, full correct view, selection, real modification and undo at equivalent settings.
5. **P2 — Public evidence:** licensed cross-industry drawings, held-out cases, reference rendering, more repetitions and lower-end hardware. Only then consider advertising a speed advantage.

The intended advantage remains faster **successful** human and AI drawing work. Loading speed is a measurable workstream, not yet a shipped superiority claim.
