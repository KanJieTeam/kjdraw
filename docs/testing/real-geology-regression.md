# Reproducing real-model geology regressions

These commands exercise the existing CAD engine using fixed **public synthetic drawings** and real provider calls. They are development regressions, not independent human acceptance, a token-efficiency comparison or a guarantee for arbitrary imported engineering drawings.

Use Node.js 22 or newer and the SDK runtime built from the source revision you are testing. Supply the provider credential through the existing private `KJDRAW_DEEPSEEK_API_KEY` environment variable, never a CLI argument, committed file, issue or report. A configured host proxy can use `KJDRAW_BENCH_PROXY`; keep that configuration private.

## 1. Run the original questions

Inspect the selection without making a model request:

```sh
node scripts/testing/run-geology-stability.mjs --suite all-runnable --repeats 1
```

Execute with a **new** archive directory:

```sh
node scripts/testing/run-geology-stability.mjs --run --suite all-runnable --repeats 1 --output-dir .cache/my-original-geology-run
```

The runner selects executable frozen questions. Not-ready questions, provider failures and unexecuted work are not passes. The report captures the returned provider model name and execution-surface hashes; do not substitute the requested model name for the model actually returned.

An edit passes only when its actual proposal has the requested complete scope, stays pending until trusted host review, commits once and satisfies the existing native-state oracle. No model explanation, tool description or mocked transport is evidence of a real provider pass.

## 2. Reproduce failures after a repair

The [failure-rerun entry](../../scripts/testing/rerun-geology-failures.mjs) reads an original `repeat-N.json`, selects its failed frozen IDs, and makes zero calls unless `--run` is explicit:

```sh
node scripts/testing/rerun-geology-failures.mjs --baseline .cache/my-original-geology-run/repeat-1.json
node scripts/testing/rerun-geology-failures.mjs --run --baseline .cache/my-original-geology-run/repeat-1.json --repeats 1 --output-dir .cache/my-repair-rerun
```

To repeat a particular failed intent, add its exact `--intent`, for example:

```sh
node scripts/testing/rerun-geology-failures.mjs --run --baseline .cache/my-original-geology-run/repeat-1.json --intent source-strata.source-backed-description --repeats 5 --output-dir .cache/my-description-repair
```

This entry preserves the original V5 answer contract, JSON encoding and exact oracle. It archives its baseline hash, selected IDs, actual provider responses, pending proposals, per-repeat outcomes and execution surface. Existing directories are never overwritten. A focused rerun is **not** a new whole-corpus score: report every repeat, including failures, and do not assemble successes from different attempts into an invented clean run.

## 3. Keep new semantics separate

The [source-drift inspection entry](../../scripts/testing/run-geology-source-drift-inspection.mjs) is a separately versioned V6 experiment over six frozen read-only questions:

```sh
node scripts/testing/run-geology-source-drift-inspection.mjs
node scripts/testing/run-geology-source-drift-inspection.mjs --run --repeats 5 --output-dir .cache/my-drift-inspection
```

V6 requires an actual complete source inspection with exact native identities, retained facts and conflicts, plus unchanged drawing state. It also retains the old V5 verdict for those **same executions**. Do not rewrite archived V5 failures or describe V6 results as if they satisfied the different original contract.

## 4. Validate code and UI separately

```sh
npm run build:runtime
npm run build:types
npm run typecheck
npm test
npm run check
```

Independent DXF interoperability checks require an actual Python environment with `ezdxf`. Set `KJDRAW_PYTHON` and, if needed, `KJDRAW_EZDXF_PATH` to that environment; `KJDRAW_BENCH_INTEGRATION_REQUIRED=1` makes missing interoperability prerequisites fail rather than silently skip.

Browser tests verify UI interaction against native CAD execution using controlled transports. They do not demonstrate that a real model understands every user request. Publish their results separately from actual provider tests.

## Evidence to include with a contribution

- Original question IDs, original failure archive hash and source revision.
- Exact repair scope; no changed frozen questions, fixtures or old scoring rules.
- Per-repeat results, actual returned model names, request counts and remaining failures.
- Before/after native identity and source-data checks, host approval and reopening evidence where applicable.
- SDK/typecheck/interoperability/UI outcomes, listing skips and unexecuted work.

Use synthetic or explicitly authorized sanitized data only. Public evidence must not include API credentials, customer drawings, organization information, personnel, private source paths or raw project databases. Keep internal archives local until their content has been reviewed for publication.
