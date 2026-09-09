# Core performance and large-drawing Agent acceptance

Date: 2026-09-09. Follow-up to the [local-corpus baseline](local-corpus-acceptance-2026-09-09.md). This increment advances loading and model-neutral editing together; it does not complete stable 1.0 or establish a global performance ranking.

## Shared-core changes

- Index block entity membership per mutable owner array instead of repeatedly scanning it. Replacing an owner array rebuilds the index; reparenting, hard deletion, rollback and history restoration are covered.
- Calculate the existing FNV-1a64 fingerprint with exact two-word arithmetic instead of a BigInt operation for every byte. Known vectors, randomized UTF-16 inputs, UTF-8 conversion and canonical serialization remain byte-compatible. Cryptographic SHA-256 approval binding is unchanged.
- Fast-path ASCII name normalization while retaining the existing en-US Unicode fallback. Normalize newly created geometry once before insertion; full graph validation still runs at commit.
- Reuse immutable object views across queries and table views. Commits, authority adoption, undo and redo invalidate caches; callers cannot mutate the stored document through returned views.

## Browser loading

Same six private DXFs, three engines and three repeats per combination: **54 completed calls**, no call failures or external browser requests. Final generated-runtime bundle SHA-256: `b05fada2fbe0ea2e3572074fdf0a2804027fdad78a28b1fd08668ce552eb95ce`.

Windows x64; i9-13900HX; Chrome 152.0.7977.77; RTX 4050 Laptop GPU via ANGLE/D3D11; 1280 × 800 at DPR 1. Node 24.19.0; dxf-viewer 1.0.48; dxf-parser 1.1.2. The [same opt-in protocol](../benchmarks/browser-load-comparison.md) preloads file/font bytes. These are API-load medians in milliseconds, not equivalent editor initialization, correct-display completion or cold page navigation.

| Case | Previous KJDraw | Current KJDraw | Same-round dxf-viewer | dxf-parser, parsing only |
| --- | ---: | ---: | ---: | ---: |
| 01 Complete plan | 599.4 | 487.0 | 252.9 | 48.0 |
| 02 Section sketch | 558.5 | 417.0 | 255.1 | 17.3 |
| 03 Complex template | 2,269.5 | 1,325.1 | 343.5 | 83.8 |
| 04 Generated plan fixture | 257.7 | 180.3 | 190.5 | 7.8 |
| 05 Generated section fixture | 134.9 | 83.3 | 164.1 | 4.9 |
| 06 Symbol library | 157.6 | 104.4 | 186.4 | 6.9 |

Case 03 takes approximately **42% less time than the preceding KJDraw measurement**, but remains about 3.9× the viewing baseline. Its current range is 1,257.9–1,357.4 ms. A preceding development build measured 1,217.0 ms median; the final rebuilt artifact above is the acceptance result. Three repetitions and sequential rounds cannot isolate all machine variability or support a p95 claim.

Rendering gaps remain: cases 02/05/06 omit 77/46/60 HATCH objects respectively. Those shorter timings are not wins over a renderer showing more content. Text/hatch approximation and font/style differences also remain. The parser omits HATCH categories and does not build an editor or viewing scene. No overall winner is declared.

## Agent previews on the real corpus

`document.fork()` creates a detached copy-on-write branch at the current revision. Unchanged internal records can be shared, but mutations, queues, listeners, authority and undo history are independent. Preview no longer serializes and reopens the entire drawing. The original snapshot identity and revision must remain unchanged while preview preparation runs; normal approval still binds the full document with SHA-256.

Limits now apply to 250,000 document objects, 4 MiB of combined command arguments and touched input records, 64 changed objects and 256 KiB of output geometry. This is **not yet a fully incremental working-set engine**: snapshot creation, graph validation, fingerprinting, change inspection and approval binding still involve the full document. No hard process-memory or latency bound is claimed.

The former failing case contains **9,029 entities** and a **9,871,273-byte JSON snapshot**. It now completes a real core MOVE proposal, host approval, exact endpoint displacement, unchanged-other-entity verification, undo and redo. All five LINE-bearing corpus files pass this sequence; the sixth has no LINE candidate and is not counted as a successful move. These are local tool-session regressions, not claims that a model designed these private drawings.

All six original file hashes remain unchanged. Independent ezdxf rereads retain entity-type counts, units and text multisets. Two files still lose one layout and need an ownership-related audit repair; no full-fidelity acceptance is implied. Private drawings, source paths, screenshots, names and raw reports stay outside the public repository.

## Live model pilot

Six authorized requests used the existing DeepSeek v4 Flash connection: three synthetic tasks, each attempted once with KJDraw and once as direct ASCII DXF. No private drawing was sent. Temperature 0, thinking disabled, output cap 4,096 tokens, tool schema included in input usage; cached tokens are reported by the provider. No automatic retry or correction was performed. The task prompts and validator are in the [paired pilot](../../scripts/benchmarks/deepseek-drawing-pilot.py).

| Task | KJDraw validation | Direct DXF validation | KJDraw / direct total tokens | KJDraw / direct elapsed seconds |
| --- | --- | --- | ---: | ---: |
| Mounting plate | Pass | Invalid DXF structure | 1,940 / 838 | 2.696 / 2.809 |
| Bolt flange | Pass | Invalid DXF structure | 1,729 / 667 | 4.461 / 2.308 |
| Stepped profile | Pass | Requires 2 audit repairs | 1,675 / 626 | 1.684 / 2.505 |

Independent ezdxf 1.4.4 checks measured geometry at tolerance 1e-6, units, extra shapes and audit findings. KJDraw is **3/3**, direct DXF **0/3** on this run under a no-repair criterion. The stepped-profile baseline has matching measured geometry and units, but is not clean without repairs. Earlier pilot outcomes remain in their historical records; this small sample does not establish general model superiority.

Total tokens are **5,344 versus 2,131**; output tokens alone are 1,059 versus 1,500. Model-response time totals 5.935 versus 7.609 seconds, while recorded end-to-end time totals 8.841 versus 7.622 seconds. A local corpus regression overlapped the live run, so host-side timings are exploratory and must not be used as an isolated performance comparison. Cost was not calculated. The defensible result is successful structured drawing on these tasks, **not lower total token use or universally faster completion**.

## Next acceptance slices

Verification for this increment: Node 22 and Node 24 SDK suites each pass **360/360**, including packed consumers and generated TypeScript/runtime checks. Strict declaration generation, bilingual documentation generation, repository release checks (512 files) and whitespace checks pass.

1. Fix the observed layout ownership and HATCH rendering failures with redistributable regressions.
2. Reduce Agent input overhead with task-selected tools and focused geometry queries; keep all input, output, cached tokens and failed attempts in paired reports.
3. Replace remaining whole-document preview/digest work with measured incremental processing without weakening revision/content checks or silently excluding dependencies.
4. Add a larger synthetic multi-step create → revise → validate → export task and held-out variants, bounded correction budgets and multiple repetitions. Test real provider endpoints independently; sharing a protocol adapter is not live certification of every model.

This increment does not publish an npm version or stable tag, and does not assert downstream Kanjie UI integration acceptance.
