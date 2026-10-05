# Three-model release holdout

The stable 1.0 gate needs live results from three distinct model vendors, including at least two domestic Chinese vendors, on at least two real operating-system platforms. Fixture replies and simulated provider traffic do not count. The suite has 30 versioned CAD cases: 17 paired drawing-generation cases and 13 stateful behavior cases. Each model runs at least five repetitions; acceptance requires the per-model thresholds enforced by `model-holdout-evidence.mjs`.

Before paying for live calls, inspect the task plan without credentials:

```sh
node scripts/benchmarks/release-holdout-behavioral-runner.mjs
node scripts/benchmarks/paired-model-benchmark.mjs --task-suite=release-holdout-generation --max-requests=170 --max-output-tokens=16384
```

Create an ignored `.cache/release-evidence/three-model-holdout-run-config.json` using schema `com.kanjie.kjdraw.audit.three-model-holdout-run-config@1`. It must name the exact repository, full candidate commit, scoped package name/version, five or more repetitions, and exactly three model entries. Each entry has a distinct `id`, `vendor.id`, `requestedModel`, a real remote HTTPS Chat Completions endpoint, an environment-variable *name* (`apiKeyEnv`), `runOn.platform` (`win32`, `linux` or `darwin`) and architecture, plus explicit provider settings. Never put API key values in the JSON or commit the file. See `validateModelHoldoutRunConfig` in `scripts/audits/run-three-model-holdout.mjs` for accepted fields and limits.

Set each key only in that runtime's environment, then run the assigned models from the identical clean candidate checkout:

```sh
node scripts/audits/run-three-model-holdout.mjs --config=.cache/release-evidence/three-model-holdout-run-config.json --workspace=.cache/release-evidence/three-model-holdout-run
```

One platform will normally report `pending` until the other platform's immutable reports are copied into the same evidence workspace. An interrupted attempt is never silently reused; inspect it before an explicit `--retry-incomplete`. Once all three live runs are complete, the runner writes the bound manifest and `three-model-holdout.json`. Place that evidence at `.cache/release-evidence/three-model-holdout.json` for `node scripts/audits/release-readiness.mjs`; the verifier checks source hashes, exact candidate identity, distinct vendors, runtime diversity, complete request counts, no human intervention, and per-model outcomes. Keep raw requests, responses, credentials and private drawings out of Git.

This is a costly benchmark, not a marketing screenshot. A failed model or threshold is a failed gate to investigate, not a reason to lower the criteria or change a report after the run. Every source commit invalidates the candidate-bound evidence and requires a fresh run.
