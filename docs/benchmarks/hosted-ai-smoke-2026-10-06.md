# Hosted AI development smoke — 2026-10-06

The actual public AI page and actual DeepSeek API completed a synthetic DXF
section's ten consecutive **graphics-only text edits**. This is a development
smoke, not independent-user acceptance, source-data relayering, a general CAD
correctness benchmark or evidence of token savings.

## What was measured

The deployed runtime matched commit
`ed7e5be38873834a51d82dcc1c03f9bf68f34dfe`, SHA-256
`aa6b4e267899bc8a01cacd5e5036c0057832cd84ff676f1488122453be54f468`,
before credentials were entered. The requested model was `deepseek-chat`;
these reports do not independently capture the provider's resolved model ID.
No model responses were mocked. Isolated browser contexts used only synthetic
data; neither customer drawings nor connection credentials are published.

The generated test section has three synthetic holes, nine declared strata,
125 native entities and 15 HATCH entities. It is exported and uploaded as
ordinary DXF, **without claiming a retained source-data recipe**. Ten prompts
change project labels, a graphical hole label and a historical note, including
literal Chinese append/prepend and mixed-language replacement.

Before each test approval, the independent expected label is compared against
the complete native before/after preview. Incorrect proposals are not approved.
The automated oracle is a **test reviewer**, not a real independent user.
After each approved change:

- Every native entity ID, type and payload is checked against the previous
  drawing with exactly the one expected text edit. This includes unchanged
  geometry, HATCH payloads and other labels.
- The downloaded DXF is reopened and checked for structural validity, entity
  count and the exact changed label. This is not a certification of arbitrary
  DXF lossless round trips or UUID persistence through DXF.
- The actual page is refreshed; its restored document must retain the exact
  native entity records. This uses the application's internal browser archive,
  not a claim that DXF preserves internal UUIDs.

## All runs of this entry, including failures

| Run | Result | Real provider requests | Interpretation |
| --- | --- | ---: | --- |
| [Circle 01](evidence/2026-10-06-hosted-ai-smoke/circle-01.json) | 1/1 | 2 | Actual proposal, test approval, DXF reopen and refresh passed |
| [Geology 01](evidence/2026-10-06-hosted-ai-smoke/geology-01.json) | 0 completed | 0 | Harness selected a model alias absent from the current preset dropdown; no model-quality measurement |
| [Geology 02](evidence/2026-10-06-hosted-ai-smoke/geology-02.json) | 0 completed | 0 | Harness tried to sort the SDK's readonly entity array in place; no model-quality measurement |
| [Geology 03](evidence/2026-10-06-hosted-ai-smoke/geology-03.json) | 10/10 | 20 | Initial complete ten-round run passed |
| [Geology 04](evidence/2026-10-06-hosted-ai-smoke/geology-04.json) | 0 approved | 3 | Strengthened test reviewer compared in-memory records directly with their JSON representation and rejected the first preview |
| [Geology 05](evidence/2026-10-06-hosted-ai-smoke/geology-05.json) | 10/10 | 21 | Final complete run passed with the corrected canonical preview check |

Run 04 remains a failure record; it has not been rescored. The offline native
preview reproduction had identical canonical CAD content. The corrected
reviewer uses the engine's existing canonical JSON representation to account
for optional in-memory fields that JSON cannot retain. Negative tests still
reject changed text whitespace, position, target ID, revision, extra targets
and an absent before preview **before approval**. No production runtime was
changed to obtain these results.

These are known development questions, not a blinded holdout or repeated
cross-model estimate. The runs cover neither soil reclassification nor layer
splitting, section-link editing, HATCH replacement or arbitrary imported plans.
Those capabilities require their own source-fact, geometry and model checks.

## Separate source-backed language stability run

The same checkout also ran the existing **24 fixed colloquial Chinese and
English geology questions five times** through the real model transport and
the local chat runtime. This is separate from the deployed-browser smoke above:
it is not a browser measurement, a blinded holdout, an independent human review
or a token-efficiency comparison.

The [unchanged run summary](evidence/2026-10-06-hosted-ai-smoke/natural-language-03.json)
records **117/120 passed, 3 failed**, using 265 actual provider requests.
`deepseek-chat` was requested; responses reported `deepseek-flash`. All five
repeats used execution-surface SHA-256
`0d1978d534f35dfbb970d6c66b86c4589df02a5b6348c54a3f808a6466c1703b`;
the question corpus SHA-256 was
`5b87d94884d24f375b04d98f485fe11aaf3768776f38f73df3a748ca6e616d0c`.
No failed attempt was rerun into the same archive or rescored as a pass.

| Failed question | Observed failure | Approval outcome |
| --- | --- | --- |
| Repeat 2, Chinese historical DXF note addition | Model appended ` 复核版` with an unrequested leading space | Exact reviewer rejected the proposal; no commit |
| Repeat 4, English column split | Supplied replacement names `砂土` and `砾砂` became `沙` and `砾石` | Exact source/geometry reviewer rejected the proposal; no commit |
| Repeat 5, English section split with supplied links | Model treated the complete replacement table as contradictory and asked for confirmation rather than proposing it | No proposal or commit |

These remain unresolved model-following failures, despite existing guidance
about literal values and replacement tables. The engine's review boundary
prevented a bad commit; that is **not** successful task completion. This run
does not establish arbitrary drawing editing, 100% reliability, general
ten-round correctness or any percentage of token savings.

To reproduce from this revision, set the provider key in the local environment
as described below, then use a **new** output directory:

```sh
node scripts/testing/run-geology-stability.mjs --suite natural-language
node scripts/testing/run-geology-stability.mjs --run --suite natural-language --repeats 5 --output-dir .cache/geology-language-new
```

The first command makes zero model calls. The second retains every repeat,
pending proposal and bounded public-synthetic provider diagnostic locally, and
exits nonzero when any selected question fails. Its synthetic fixtures,
questions, exact native/source oracles and runner are included in the repository.
The public summary does not contain credentials, private drawings or provider
error bodies. Existing earlier failure archives remain unchanged.

For broader coverage, the additive `all-runnable` suite selects **every** frozen
question currently marked runnable by preflight, in corpus order. It does not
select only previously successful questions or alter their oracles:

```sh
node scripts/testing/run-geology-stability.mjs --suite all-runnable --repeats 1
node scripts/testing/run-geology-stability.mjs --run --suite all-runnable --repeats 1 --output-dir .cache/geology-all-runnable-new
```

The dry-run output reports selected and not-ready counts. Paid execution is
capped at 2,000 provider requests per repeat; a halt, exhausted budget or any
failed selected question exits nonzero. Providing this entry is not evidence
that the broad suite has passed. The 117/120 results above remain the original
24-question measurement, not a measurement of all runnable questions.

## Reproduce

Use a Node.js 22+ source checkout with its locked development dependencies and
an installed Chromium/Chrome. The script defaults to a zero-call dry run:

```sh
node scripts/testing/run-hosted-ai-smoke.mjs --suite imported-geology
node --test tests/hosted-ai-smoke-entry.spec.mjs
```

Set `KJDRAW_DEEPSEEK_API_KEY` in your local environment or existing secret
manager, never in command arguments or committed files. Paid execution must be
explicit, and each attempt must use a new output directory:

```sh
node scripts/testing/run-hosted-ai-smoke.mjs --run --suite circle --output-dir .cache/hosted-circle-new
node scripts/testing/run-hosted-ai-smoke.mjs --run --suite imported-geology --output-dir .cache/hosted-geology-new
```

Optional `KJDRAW_CHROME_PATH` selects an installed browser and
`KJDRAW_BENCH_PROXY` selects your network proxy. No public proxy is deployed.
If the deployed runtime differs from the checkout, the script stops before
sending credentials. Existing report directories are never overwritten;
failures exit nonzero and retain the completed-round count and failure stage.
Artifacts exclude credentials, provider error bodies, screenshots of settings
and chat transcripts. Do not interpret a successful smoke as formal 1.0
acceptance or replace independent testing with it.
