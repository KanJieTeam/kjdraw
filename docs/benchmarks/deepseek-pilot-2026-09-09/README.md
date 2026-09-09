# DeepSeek drawing pilot — 2026-09-09

An exploratory comparison of **KJDraw tool-assisted drawing vs direct ASCII DXF generation**, using the same configured `deepseek-v4-flash` model. This is not a comparison against another CAD library, a harness leaderboard or evidence of general model superiority.

## Result after unit fixes

| Task | KJDraw: model seconds / total tokens / validation | Direct DXF: model seconds / total tokens / validation |
| --- | --- | --- |
| Mounting plate, four holes, rounded slot | 2.731 / 1,940 / passed | 2.752 / 741 / failed |
| Flange with six equally spaced bolt holes | 1.977 / 1,717 / passed | 1.888 / 530 / passed |
| Stepped profile with three holes | 1.689 / 1,675 / passed | 1.596 / 532 / failed |

| Aggregate, three requests per arm | KJDraw | Direct DXF |
| --- | --- | --- |
| Correct independently readable drawings | 3/3 | 1/3 |
| Mean model request duration | 2.132 seconds | 2.079 seconds |
| Input tokens, including tool schemas | 4,285 | 631 |
| Output tokens | 1,047 | 1,172 |
| Total tokens | 5,332 | 1,803 |
| Mean generation + materialization + validation duration | 2.499 seconds | 2.084 seconds |

**The result supports a small-sample reliability observation, not a speed or total-token saving claim.** KJDraw used more input tokens because the request included its tool schema. End-to-end timing also includes launching a Node materialization process on the KJDraw arm. Failed baseline drawings are included in its timing, so its average is not time-to-success. Monetary cost is not reported: token usage is measured, but applicable billing rates were not verified.

Raw metrics: [round 2](round-2-after-fixes.json). Returned model IDs matched the requested model. Prompt-cache hits varied and are retained in the usage records.

## Method

- Three original synthetic tasks; one attempt per arm, no retries, no manual repair of model output. Six real provider requests in this round.
- Same task text, model, `temperature: 0`, `thinking: disabled`, non-streaming generation, maximum 4,096 output tokens and 120-second timeout.
- KJDraw receives a drawing tool schema and must return one `cad_propose_drawing` call. The host materializes that proposal on an isolated synthetic drawing and exports DXF.
- The baseline receives a format-specific instruction to return a complete ASCII DXF, with no CAD library/tools. This is deliberately a no-tool baseline, not the strongest possible alternative.
- Both outputs are checked by **ezdxf 1.4.4**, independently of KJDraw's importer: units must be millimeters, expected lines/circles/arcs must match within `1e-6`, and the document must have no additional geometry or audit errors/fixes. Closed straight polylines and their equivalent line segments are accepted.
- The task prompts do not explicitly state the numerical tolerance. A future pre-registered study must specify that tolerance to both arms and include multiple repetitions and held-out tasks.
- The validator opens strings with universal newline handling, matching normal file reading. No model-generated code is executed. Geometry and file outputs are treated as data.

Token fields are the provider's returned `usage`, including prompt/cache and completion counts, as documented in the [DeepSeek Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/). This pilot sets thinking mode explicitly; it does not measure thinking-enabled performance.

## What the first round exposed

The [original round-1 report](round-1-before-fixes.json) is retained, not replaced by a favorable rerun. All three KJDraw proposals used `mm` where the drawing expected `millimeter`, so they failed before application. Tool schemas now expose the drawing's canonical unit as an enum. The first validator also lacked universal newline handling; its direct-DXF validation rate must not be compared to round 2.

Independent offline self-tests then exposed missing `$INSUNITS` in KJDraw's modern DXF export. Export now labels physical units and measurement, and import reads them without rescaling geometry. Absent insertion units are imported as unitless instead of assuming millimeters. The fix and its offline self-tests were completed before round 2. See [ezdxf's units documentation](https://ezdxf.readthedocs.io/en/stable/concepts/units.html) for the distinction between drawing units and measurement settings.

There were **12 paid-endpoint requests across both exploratory rounds**, not just the six used in the final table. The first round is a debugging run; changes between rounds mean they must not be pooled into a statistical A/B claim.

## Reproduce

The public helpers contain no Kanjie configuration access or credentials:

```sh
python -m pip install -r scripts/benchmarks/requirements.txt
python scripts/benchmarks/deepseek-drawing-pilot.py --self-test
```

For a live pilot, explicitly configure `KJDRAW_BENCH_MODEL=deepseek-v4-flash`, `KJDRAW_BENCH_API_KEY`, and `KJDRAW_BENCH_OUTPUT` in your environment, then run:

```sh
python scripts/benchmarks/deepseek-drawing-pilot.py --live
```

This makes at most six requests. It stops on transport/authentication errors, writes synthetic requests/final responses/usage/DXF artifacts, and never writes credentials or hidden reasoning. CI runs only `--self-test`; it never spends model credits. The private local configuration bridge used for the original runs is not published.

## Next evaluation

Build a versioned complex assembly-sheet task with dimensions, repeated components and successive user changes. Keep one public demonstration case, plus parameter variations and held-out cases. Compare first-pass correctness, time to a valid result, all input/output tokens, recovery attempts and unintended changes. Add a credible library-assisted baseline and repeated runs before making comparative marketing claims.
