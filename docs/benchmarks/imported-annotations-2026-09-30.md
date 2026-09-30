# Imported annotation edits: exploratory model runs

These runs test one narrow, useful operation: find a native annotation in an imported DXF, then change or move that same text object over ten cumulative rounds. They do **not** test geological interpretation, borehole-data changes, re-stratification, arbitrary drawing edits, or production suitability.

## Protocol and checks

The [protocol and exact scoring harness](../../scripts/benchmarks/imported-annotation-model.mjs) fixes five text replacements and five displacements. No target object ID is supplied to the model. It must locate the current annotation through CAD tools. Each proposal is checked before harness approval; every other entity must remain unchanged. KJD and DXF are saved and reopened after every approved round. A failed round ends the journey rather than resetting the drawing or skipping forward.

Approval here is automated by an exact oracle, **not independent human acceptance**. DXF reopen checks compare source handles, normalized supported geometry and named resources; they do not promise universal lossless DXF metadata preservation or UUID stability. KJD retains object identity; DXF reimport creates new runtime IDs.

The fixture is [public and generated](../../tests/helpers/public-annotation-sheet.mjs). Model versions below are provider-returned aliases, not immutable vendor snapshots. One run per provider/source/policy is a pilot, not a held-out comparative benchmark. The workflow was refined after observing earlier runs; results must not be described as preregistered or statistically representative.

## Results, including the failed journey

| Drawing and policy | Model | Approved rounds | API requests | Reported total tokens |
| --- | --- | ---: | ---: | ---: |
| Public sheet, targeted annotation reads | DeepSeek `deepseek-flash` | 10/10 | 23 | 86,943 |
| Public sheet, targeted annotation reads | Qwen `qwen3.8-flash` | 10/10 | 21 | 58,034 |
| Private section, earlier page-read policy | DeepSeek `deepseek-flash` | 10/10 | 21 | 139,246 |
| Private section, targeted annotation reads | DeepSeek `deepseek-flash` | 7/10; round 8 failed, rounds 9–10 not run | 18 | 83,114 |
| Private section, earlier page-read policy | Qwen `qwen3.8-flash` | 10/10 | 29 | 197,779 |
| Private section, targeted annotation reads | Qwen `qwen3.8-flash` | 10/10 | 31 | 101,728 |

DeepSeek's private-section failure returned a message instead of a proposal in round 8. The source drawing was not changed. Its lower token total cannot count as a successful ten-round saving. The cause of the missing proposal has not been established; retaining this failure is necessary before claiming improved reliability.

Qwen's private-section pair used 48.56% fewer reported tokens after whole-page reads were removed from annotation-only tool policies. This is **one exploratory pair**, not evidence that 99% of tasks are cheaper. Request count increased from 29 to 31. No external CAD baseline, cost normalization, or repeated-run variance was measured here.

The public runs archive [DeepSeek counters and tool-name trace](data/imported-annotations-2026-09-30/deepseek-public.json) and [Qwen counters and tool-name trace](data/imported-annotations-2026-09-30/qwen-public.json), including code fingerprints and returned model identifiers. The [earlier Qwen public capture](data/imported-annotations-2026-09-30/qwen-public-before.json) retains reported per-request counters but lacks the newer trace metadata. These archives omit API keys, prompts, model prose and tool arguments. They are counters, not billing receipts or complete raw model-response archives.

The private drawing and its query content are not published. Its aggregate results cannot be independently reproduced without access to that drawing. Do not treat anonymous private results as a public regression fixture.

## Reproduce the public fixture

Use Node.js 22+, `npm ci`, and your provider credential in the corresponding process environment (`KJDRAW_DEEPSEEK_API_KEY` or `KJDRAW_QWEN_API_KEY`). Running without `--run` makes zero model requests.

```sh
node scripts/benchmarks/imported-annotation-providers.mjs --run --provider deepseek --model deepseek-flash --output .cache/deepseek-annotation-report.json
node scripts/benchmarks/imported-annotation-providers.mjs --run --provider qwen --model qwen3.8-flash --output .cache/qwen-annotation-report.json
```

The [provider runner](../../scripts/benchmarks/imported-annotation-providers.mjs) limits each journey to 40 requests, uses a 4,096-token output limit, disables reasoning for these provider requests, records reported input/output/total usage and returns nonzero on failure. Vendor model availability and aliases can change. A run may differ even with the same model name; preserve all results instead of rerunning only until a pass.

`--drawing FILE --target-text LABEL` permits an explicit native-label test on a private DXF. It sends queried drawing context to the selected provider; it does not overwrite the source. Test a copy and do not publish project content without permission.
