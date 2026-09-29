# Token-efficiency pilot — 2026-09-29

This is a **diagnostic pilot**, not the frozen 100-task, three-repetition result and not support for a 99% claim. It used synthetic benchmark approval, not human review. The provider reported token counts; bytes were not used as a token proxy.

| Provider / task | KJDraw | Trusted ezdxf comparator | Interpretation |
| --- | --- | --- | --- |
| Qwen `qwen-plus`, simple corner-hole plate | Valid DXF; 794 input + 125 output = **919** total tokens | Valid DXF; 393 input + 220 output = **613** total tokens | KJDraw used **306 more** tokens. |
| Qwen `qwen-plus`, A3 fixture plate | Tool-call arguments rejected; 2,393 input + 321 output = 2,714 consumed tokens | Valid DXF; 550 input + 245 output = **795** total tokens | No valid paired comparison. KJDraw tool schema/input is too large and the response needs diagnosis. |
| Qwen `qwen-plus`, two-round hole move | Both KJDraw rounds validated; 3,509 and 3,662 total tokens | First baseline round did not compile; 687 reported tokens, second unexecuted | No valid paired comparison. Baseline failure needs diagnosis. |
| GLM `glm-4.5`, simple corner-hole plate | Provider returned HTTP 429 with business code `1113` before usage | Unexecuted after provider stop | No paired comparison. No automatic retry. |

These runs used the initial broad model-visible tool descriptions. The next arm revision will shorten *accurate* tool schemas and load only the relevant tool; that change must be versioned and the pilot repeated. The failed and unfavorable observations stay visible. The full corpus has 100 tasks and 180 requested rounds; three repetitions, two arms and three models require 3,240 planned provider requests. The dry-run plan and frozen corpus are available in `scripts/benchmarks/token-efficiency-plan.mjs` and `scripts/benchmarks/token-efficiency-task-corpus.mjs`.

## Compact function-tool pilot

The public-prompt-routed compact interface reduced the number of model-visible tools without changing the SDK validator. One diagnostic repetition on the same Qwen model gave:

| Task | KJDraw | Trusted ezdxf comparator | Paired result |
| --- | --- | --- | --- |
| Simple corner-hole plate | Valid; 733 input + 125 output = **858** tokens | Valid; 393 input + 384 output = **777** tokens | KJDraw used **81 more** tokens. |
| Two-round hole move | Both rounds valid; 610 + 763 = **1,373** tokens | Both rounds valid; 556 + 694 = **1,250** tokens | KJDraw used **123 more** tokens. |

The new KJDraw input for the first edit round was 575 tokens versus 3,474 before tool routing. This is a real reduction in its own prompt cost, but the paired comparison still did not favor KJDraw. A separate text-based Skill/CLI JSON route is under evaluation; its results must be reported as another arm version, not retroactively substituted for these outcomes.

## Compact tool-surface revision (offline only; not a replacement result)

Future reports identify this revised arm as `public-prompt-compact-v1` in report schema `@2`; previous pilot observations remain tied to the earlier broad tool surface.

The new [SDK projection](../../packages/kjdraw-sdk/src/agent-compact-tool-surface.js) is reusable by product callers; the benchmark [runner](../../scripts/benchmarks/token-efficiency-runner.mjs) uses it without changing the SDK tool execution or approval validator. Routing reads only the public request text and whether an editable seed was supplied, never task family or acceptance data. A plain one-shot drawing loads `cad_propose_drawing_basic`; an ISO A-series dimensioned sheet loads `cad_propose_manufacturing_sheet`; edit wording selects MOVE, SCALE, or STRETCH, with both STRETCH and MOVE for a rounded-slot extension. Unknown edit intent stops before a model call. The model-visible schema omits host-owned revision and units; the host supplies current values for every actual SDK call. The returned report lists the selected names in `toolRouting` and each round's `loadedTools`. The same public prompts and seed information remain available to the ezdxf comparator.

Measured UTF-8 request metadata before versus after projection, including JSON serialization of function definitions: a MOVE edit has 10,515 → 591 tool bytes; a rounded-slot edit has 10,515 → 1,650; a simple drawing has 1,392 → 1,197; a manufacturing sheet has 5,367 → 3,882. The KJDraw system message is 288 → 168 bytes. These are **bytes, not provider-reported tokens**. No new provider call was made for this revision; the unfavorable and failed pilot results above remain the only observed token evidence. This is an opt-in model-facing SDK projection and benchmark route, not yet the default published Skill or CLI surface.

For reproducibility, the runner's optional `saveModelArtifacts` callback receives the model response and identifiers after environment API-key redaction, and stops all later requests if persistence fails. Ordinary round records retain only a fixed baseline compiler reason or the byte length and SHA-256 of invalid KJDraw JSON arguments, not the malformed text itself. Persisted model artifacts can contain drawing prompts or design data and must be handled as potentially sensitive; fixture/pilot approval remains synthetic, not human review.

### Opt-in text contract, not a scored result

The SDK now also exposes an opt-in `agent-skill-json` text interface. With `interfaceMode: 'skill-json'`, the same public prompt router selects allowed operations, but the model sees a short, SDK-derived text contract and returns `{"calls":[{"tool":"...","args":{...}}]}`; no function definitions are sent. The host parses the JSON, then invokes the **same** SDK proposal, approval and independent scoring path. The trusted ezdxf arm retains its original JSON request. Mock tests cover one-shot drawings, manufacturing, ten-round edits, two-call edits, malformed JSON and disallowed tools; they do not establish real-model accuracy or token savings. The report identifies this arm as `public-prompt-skill-json-v1` under schema `@3`, separate from `function-tools` (`public-prompt-compact-v1`).

Serialized model-visible metadata (function tool definitions plus KJDraw system message, versus the Skill JSON system contract) is 1,365 → 803 UTF-8 bytes for a simple drawing, 4,050 → 1,474 for manufacturing, 759 → 586 for a MOVE edit, and 1,818 → 844 for a rounded-slot edit. These numbers omit each task prompt, model history and output; they are **not** provider-reported token savings. Accuracy and cumulative input/output tokens must be measured again before preferring either interface.

### Live Skill JSON attempt

On 2026-09-29, an initial `skill-json` pilot for three tasks returned `PROVIDER_AUTH_FAILURE` before usage because the operator mistyped the credential. The fail-fast runner made **1 of 8 planned requests** and marked the other seven unexecuted. The operator then corrected the input and repeated the same three task IDs and arm version. No credential is stored in either report.

| Qwen `qwen-plus` task, one repetition | KJDraw Skill JSON | Trusted ezdxf comparator | Paired interpretation |
| --- | --- | --- | --- |
| Simple corner-hole plate | 337 input + 87 output = **424** tokens; proposal rejected by SDK | Valid; 393 + 220 = **613** tokens | No valid pair; the apparent token saving cannot count. |
| Two-round hole move | Both rounds valid; **394 + 531 = 925** tokens | Both rounds valid; **556 + 694 = 1,250** tokens | KJDraw used **325 fewer** total tokens (26%) on this one diagnostic task. |
| A3 fixture plate | Valid; 687 + 238 = **925** tokens | Valid; 550 + 245 = **795** tokens | KJDraw used **130 more** tokens. |

This was a one-repetition diagnostic with synthetic benchmark approval, not the three-repetition, independently reviewed protocol. The simple-plate rejection remains a failure even though the provider-reported token count was lower. Two of the three task pairs were valid, and only one valid pair favored KJDraw. The failed geometry must be diagnosed and any general interface fix versioned before retesting; these observations remain tied to `public-prompt-skill-json-v1`.

### Expanded Qwen diagnostic after a product-level decoder fix

The first simple-plate failure was traced to the model repeating the first point at the end of a `closed:true` polyline. The basic drawing decoder now removes only that redundant terminal point; it still rejects other zero-length or degenerate geometry, and the original structured drawing tool is unchanged. The earlier failure above remains recorded. A new one-repetition, synthetic-approval pilot then ran ten predefined task IDs: five simple drawings, two manufacturing sheets and three two-round edits. It attempted **24 of 26** planned requests; two KJDraw follow-up rounds were unexecuted after first-round failure. Both arms were independently DXF-scored.

| Task | KJDraw total tokens | Trusted ezdxf total tokens | Outcome |
| --- | ---: | ---: | --- |
| Corner-hole plate | 424 | 613 | Both valid; KJDraw 189 fewer. |
| Radial flange | 582 | 540 | KJDraw failed; no valid pair. |
| Stepped bracket | 450 | 631 | Both valid; KJDraw 181 fewer. |
| Guide rails | 449 | 677 | Both valid; KJDraw 228 fewer. |
| Rounded slot | 459 | 639 | Both valid; KJDraw 180 fewer. |
| A2 fixture sheet | 937 | 807 | Both valid; KJDraw 130 more. |
| A1 fixture sheet | 967 | 838 | KJDraw failed; no valid pair. |
| Two-round hole move | 925 | 1,250 | Both rounds valid; KJDraw 325 fewer. |
| Two-round boundary width | 422 before failure | 1,322 | KJDraw first round failed geometry; no valid pair. |
| Two-round slot length | 623 before failure | 1,711 | KJDraw first round failed; no valid pair. |

Thus **6/10** task pairs were comparable and **5/10** predefined tasks counted as token-saving wins under the strict missing/invalid-as-non-win denominator. These are diagnostic observations only: one model, one repetition and synthetic approval. The result neither predicts nor meets the 100-task/three-model/three-repetition 99% threshold. Further general fixes will use new source hashes and fresh runs; failed outputs are not retrospectively repaired.

### Follow-up with clearer model-facing rules (v2)

A second run of the same ten IDs used an updated general Skill JSON contract: it explains closed-geometry and hole patterns, distinguishes rectangular grids from bolt circles, and states the supported STRETCH entity types and crossing-window behavior. It also received one repetition and synthetic approval. The A1 manufacturing sheet became valid, but its KJDraw call used **1,017** tokens versus the valid comparator's **838**. Radial flange still failed independent geometry validation (422 KJDraw versus 540 comparator tokens); boundary width still failed geometry after 478 KJDraw tokens, while the comparator also failed this run; slot length still failed the SDK proposal after 760 KJDraw tokens. These failures are retained as failures, not converted into savings.

The v2 batch attempted **23/26** planned requests. **7/10** pairs were comparable and **5/10** predefined tasks were strict token-saving wins; the result therefore did **not** improve the 5/10 numerator. The changed prompt, stochastic provider responses and one repetition mean v1-versus-v2 is diagnostic, not a causal estimate. The broader target remains unproven.

### Cross-model check of the same v2 interface

DeepSeek was requested using the legacy `deepseek-chat` alias; the provider returned `deepseek-flash`, which is the [current model name in its official changelog](https://api-docs.deepseek.com/updates/). It first completed a two-task smoke run: the valid simple plate used **436** KJDraw versus **618** comparator tokens; the valid two-round hole move used **922** versus **1,248**. A separate matched ten-task, one-repetition DeepSeek pilot then attempted **25/26** requests: **9/10** task pairs were valid and **7/10** predefined tasks were strict token-saving wins. All five simple drawings passed and used fewer KJDraw tokens; both manufacturing sheets passed but used **177 more tokens each** with KJDraw (A2: 931 vs 754; A1: 942 vs 765). Hole move and boundary width passed both arms and favored KJDraw (922 vs 1,248; 1,107 vs 1,311). Rounded-slot extension failed the KJDraw SDK proposal while the comparator passed both rounds, so it counted as a non-win.

GLM `glm-4.5` was retried on a simple plate and a two-round edit. It returned HTTP 429 with business code `1113` before usage on the first request, and the other five planned requests were not made. A later minimal check with a separate operator-supplied pay-as-you-go key returned the same code. This is recorded as `PROVIDER_RESOURCE_UNAVAILABLE`, not ordinary rate limiting; the exact account or resource cause is not established. Per the operator's direction, GLM testing stopped. No GLM accuracy or token result exists. Across the two reachable models, the samples show useful savings on basic and some edit tasks, a manufacturing prompt-overhead penalty, and unresolved task failures. They do **not** establish a 99%-of-tasks claim.

The [hashed Qwen and DeepSeek v2 evidence archives](evidence/2026-09-29-token-efficiency/README.md) contain the redacted model responses, usage records, validation outcomes and generated DXF from the matched ten-task pilots.

### Full 100-task diagnostic, first repetition (v2)

The same v2 Skill JSON surface was then run once on **all 100 frozen tasks / 180 requested drawing rounds** for each reachable provider. Each task has two arms, so each model had 360 planned provider requests. This remains a *diagnostic*, not the protocol's three-repetition, independently reviewed result. Both arms used the same task wording and independent DXF scoring; KJDraw proposal approval was synthetic. Failed or unexecuted tasks stay in the 100-task denominator.

| Returned model | Requests attempted / planned | Both arms correct and comparable | KJDraw cheaper among all 100 tasks | Simple drawings | Manufacturing sheets | Multi-round edits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Qwen `qwen-plus` | 324 / 360 | 69 / 100 | **39 / 100** | 25 / 30 | 0 / 30 | 14 / 40 |
| DeepSeek `deepseek-flash` | 348 / 360 | 92 / 100 | **60 / 100** | 28 / 30 | 3 / 30 | 29 / 40 |

The manufacturing result is the clearest counterexample to a blanket token-efficiency claim: all 30 sheets were valid in both arms for both providers, yet KJDraw's model-facing manufacturing contract was longer and it saved total tokens on only 0 Qwen and 3 DeepSeek sheets. Radial bolt-hole drawings and exact-radius edits also exposed correctness weaknesses. These observations motivated a **new v3 tool surface** with an existing polar-array proposal routed for bolt patterns, a precise circle-radius edit tool, and a shorter but still SDK-validated contract. The v2 artifacts are not reclassified or repaired after this change. A v3 result requires fresh model calls and a distinct source/version label.

The complete [v2 diagnostic evidence archives](evidence/2026-09-29-token-efficiency/README.md) include redacted model responses, all 360 per-round result records per model, and generated DXFs. Their one-repetition, synthetic-review status and the parameterized family structure of the 100 tasks must accompany any citation. **Neither model met 99%; no public 99% claim is justified.**

### Targeted v3 check; not a replacement for the 100-task result

After introducing a routed polar-array proposal, an exact target-radius edit tool, one-call new-drawing contract and a shorter manufacturing instruction, six *preselected diagnostic* tasks were rerun once per model. The trusted comparator and scoring rules were unchanged. Every KJDraw radius edit and radial-flange round passed independent validation, including the previously troublesome four/five-hole arrays. The known slot-length weakness remains visible.

| Returned model | Requests attempted / planned | Comparable tasks | Strict cheaper tasks | Radial flange (KJDraw vs comparator) | A3 manufacturing sheet (KJDraw vs comparator) |
| --- | ---: | ---: | ---: | --- | --- |
| Qwen `qwen-plus` | 17 / 18 | 5 / 6 | 2 / 6 | Valid but **620 vs 540** and **622 vs 542** tokens | Valid, **900 vs 795** tokens |
| DeepSeek `deepseek-flash` | 17 / 18 | 4 / 6 | 3 / 6 | Valid and cheaper: **956 vs 980** and **798 vs 975** tokens | Valid, **2,119 vs 2,040** tokens |

Qwen failed the KJDraw slot-length proposal; DeepSeek's slot-length result failed KJDraw geometry validation, and its comparator failed the first round of one radius-correction task. These are non-wins. The v3 sample shows a correctness improvement for radial holes and exact-radius proposals, **not** a demonstrated overall token advantage. Generalization requires a fresh full-corpus, three-repetition run on this exact version. [Sanitized v3 spot archives](evidence/2026-09-29-token-efficiency/README.md) retain the failures and DXFs.
