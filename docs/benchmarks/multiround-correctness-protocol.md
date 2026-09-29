# Multi-round CAD correctness benchmark — preregistration draft

**Status: design draft, not a frozen benchmark and not a result.** Do not run a scored model batch or claim a ten-round advantage from this document alone. Freeze a task manifest, scorer, arm adapters, model IDs/settings, dependency versions and their SHA-256 hashes in a separate commit before the first scored request. Any subsequent task, prompt, tool, validator or retry-policy change starts a new named version; retain the failed version's evidence.

## Question and scope

Primary question: after ten sequential instructions on the *same editable drawing*, does a model using the published KJDraw Skill/CLI complete more whole tasks correctly than a capable file-editing Agent using `ezdxf`? A second strong comparator uses the existing declarative `ezdxf` compiler. This is not a comparison against a deliberately weak model that rewrites raw DXF each turn. Token use, latency and price are secondary; the separate [token-efficiency protocol](token-efficiency-protocol.md) governs any token-saving claim.

Existing 100-task token pilots and their v1–v3 iterations are **development evidence**, not a fresh holdout. Previously inspected or tuned tasks cannot be relabeled as unseen. A new holdout custodian must commit hashes and family counts before scoring, keep answer files inaccessible to arm operators, and publish tasks and answers after evaluation. The existing 30-task release holdout must remain isolated from prompt/tool tuning; if it has already informed a change, label it contaminated and replace it for the scored run.

## Dependency order

1. Finish the independent DXF comparator, including an explicit policy for DXF internal-ID regeneration. The [read-only document diff helper](../../scripts/benchmarks/semantic-entity-diff.mjs) now reports exact KJD entity, table-object and document-resource changes, untouched entities and handle-associated ID churn. It remains a benchmark primitive, **not** a tolerance-aware independent scorer or public SDK API.
2. Decide the published tool surface and vertical planner package boundary, then freeze the exact npm package, Skill, CLI, schemas and source hash. Do not change tools midway through a scored batch. Formatting-only changes may proceed independently.
3. Freeze this protocol's manifest and scorer; run offline fixtures and a small **development-only** smoke set. Resolve scorer disagreement before exposing holdout answers.
4. Run the paid, paired three-arm study and publish every attempted, failed, timed-out and unexecuted unit.

## Frozen task manifest

- At least 100 tasks across separately reported mechanical, site/road, geology and generic CAD families. Do not count parameter variations as unrelated archetypes; cluster by family in analysis. Include professionally specified geometry, layers, annotations, blocks/references and preserved entities only where all three arms can represent them under the stated supported subset.
- Each task has one seed drawing or creation request, **ten sequential user instructions**, and answer data for every round. Include referential instructions such as “change the second hole from the left to diameter 8,” plus deliberate ambiguity that should be rejected instead of guessed. Include at least one approved deletion, one precise edit, one unrelated protected object and one operation that tests relationships.
- Perform an undo/redo checkpoint after round 4 and a DXF export/reopen checkpoint after round 5, identically in all arms. Round 6 must refer to an object from before the DXF checkpoint. Record both native internal IDs and DXF handles: changed UUIDs after reimport are an **observed boundary**, not silently treated as preserved identity. Re-identification using available geometry/handles is allowed equally for every arm and its model-visible cost is counted.
- The model sees current user instructions and permitted drawing inspection, never answer geometry, expected IDs, validator internals or future rounds. Store public prompt/seed hashes separately from private acceptance hashes until release.

## Three competitive arms

| Arm | Permitted method | Same restrictions |
| --- | --- | --- |
| KJDraw | The frozen **published** Skill/CLI and deterministic CAD compilers; proposals require the stated review gate before commit | No unpublished hidden tool, answer access or manual geometry repair |
| Programming Agent + `ezdxf` | Read the current DXF, write a targeted Python patch, run it, inspect/audit its output and revise within the shared retry budget | Execute model code only in an OS-isolated sandbox with network/secret access denied; source-hash review is required otherwise |
| Declarative `ezdxf` | Model emits the frozen structured edit plan, executed by the existing trusted compiler | No answer-aware planner, special-case task IDs or unpublished repairs |

The programming Agent is allowed loops, calculations, file inspection and targeted edits; it must not be forced to regenerate a whole DXF. All arms get the same drawing, instructions, units, model/version, context budget, retry/repair opportunities and post-round validator feedback. Disclose any unavoidable asymmetry (for example, native KJD history versus DXF-only history) before the run. Alternate arm order and randomize task order with a committed seed.

## Scoring and statistics

At each round, independent validators check expected geometry within prespecified per-field tolerances; units; layers; annotations; blocks/references; KJD/DXF readability; intended target changes; and **all pre-existing non-target entities unchanged**. The exact KJD entity diff flags any unexpected ID, geometry, property, owner or reference change. The independent DXF scorer matches stable handles where possible and separately reports ID churn, lost references and semantic differences. A rendered image or the model's own success statement cannot replace these checks.

Primary endpoint: a task trial succeeds only if all ten rounds, the undo/redo checkpoint and the DXF checkpoint pass with no unreviewed mutation. A failure at any round is a failed trial; later rounds may be attempted for diagnostics but cannot restore primary success. Report per-round survival, first-failure cause, unintended-change count, reviewer interventions and checkpoint failures. Secondary endpoints are provider-reported cumulative input/output/reasoning tokens, wall time, tool calls, human review actions and cost under published prices; missing usage remains missing rather than estimated from bytes.

Run **at least five repetitions per task, model and arm**, with at least three model families including one non-Chinese provider. Pin returned model ID and settings (temperature, thinking mode, caps, timeout, cache policy); abort and version the study if the provider silently changes model. Use paired task/repetition comparisons and family-clustered uncertainty intervals, not 500 correlated variants presented as 500 independent archetypes. Report absolute completion rates and pairwise differences for each model and family. A public “more reliable after ten rounds” claim requires a prespecified positive paired difference whose 95% family-clustered interval excludes zero; report contrary models and categories equally. No 99%-token claim follows from this endpoint.

## Independent first-use gate

Before a stable 1.0 claim, ask **12 first-time users** who did not build the product to follow only the published README on clean environments spanning at least two operating systems. Predeclare success as at least **10/12** reaching an approved, saved and reopened KJD drawing without staff help within **30 minutes**; record time to first valid drawing separately. Publish anonymized failures, exact package/commit, client/model, OS and whether network/CORS or documentation caused the stop. These thresholds are proposed release gates, not achieved results. Do not count coached demos as independent trials.

## Reproducibility and stop rules

Archive the frozen manifest/scorer/arm hashes, npm package integrity, Python/`ezdxf` versions, model request IDs and returned names, redacted requests/responses, proposal/review receipts, every intermediate KJD/DXF, validator reports, failure reasons and replay commands. Never archive API keys or customer drawings without explicit rights. A provider quota/auth error stops that provider's remaining work; unexecuted units stay in the denominator and report. Never manually patch a failed output or tune against the holdout, then present the rerun as the original preregistered score.

This draft establishes the order and acceptance rules. The manifest, independent tolerance-aware DXF scorer, isolated programming-Agent executor and independent holdout custody are **not yet implemented**, so no scored run is authorized by this document.
