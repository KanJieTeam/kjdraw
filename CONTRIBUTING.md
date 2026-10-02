# Contributing to KJDraw

English | [简体中文](CONTRIBUTING.zh-CN.md)

**Want to contribute another installable Skill?** Start with the [Skill developer guide](docs/contributing-skills.md) and [independent sample/catalog](skills/README.md). Reusing existing CAD tools needs a new workflow directory and focused tests, not changes to the general CAD Skill or engine.

Thank you for helping build an open CAD foundation. Technicians, engineers and developers from any industry can contribute without changing the CAD kernel. A useful first contribution is a small synthetic DXF, a reproducible daily task, a data rule, or a reusable planner with an explicit contract. You do not need to find UUIDs or write code first: describe the natural task, public-safe sketch/range and expected result; the implementer binds IDs through native reads and clarifies ambiguity rather than guessing your data.

## Start with one real task

1. Open a [domain contribution issue](https://github.com/KanJieTeam/kjdraw/issues/new?template=domain_contribution.yml) ([form source](.github/ISSUE_TEMPLATE/domain_contribution.yml)). Describe the daily task, supplied facts and units, expected result, what must remain unchanged, and when the operation must refuse or ask for clarification. A text description or synthetic sketch is enough to begin; customer files and API keys are never required.
2. Agree on a small scope with a maintainer. Large API, document-format or geometry-authority changes need an issue or [RFC](docs/rfcs/0000-template.md) before implementation.
3. Fork the repository, create a branch such as `codex/domain-unit-fixture`, and make one focused change. Contributors without a development setup can start with the issue and public-safe fixture instead.
4. Add a reproducible test and the relevant checks below. Open a minimal PR linking the issue; state actual commands, results, skips and limitations. Do not describe fixture tests as real-model runs or unperformed checks as passes.

Keep reusable contributions in independently understandable modules: documented inputs, bounded outputs, licensed sources, tests and a narrow host adapter. A large bundle, an automatic tool registration, or a new Skill directory is not a substitute for these contracts.

The engine is shared across industries; workflows, templates, rules and input schemas belong in independently scoped domain packages. Reuse existing operations first. Propose a missing high-level compiler as a separate planner/plugin; propose a missing primitive as a focused engine change. The [cross-industry guide](docs/contributing-skills.md) lists contribution directions, not finished industry products. Do not inherit geology-specific data fields, layer names or engineering assumptions in an unrelated workflow.

## Choose a contribution seam

These are existing reference paths, not permission to change every listed module in one PR.

| Contribution | Existing reference / destination | Minimum submission |
| --- | --- | --- |
| Daily task or compatibility fixture | [tests/fixtures/](tests/fixtures/), [tests/](tests/), [SDK tests](packages/kjdraw-sdk/test/) | Public-safe minimal file or generator; provenance; caller facts, units, expected/actual results; positive and refusal cases. |
| Domain planner or host plugin | [examples/domain-planner-starter/](examples/domain-planner-starter/README.md), [examples/plugin-starter/](examples/plugin-starter/README.md) | Pure fact-to-intent planner, input/output contract and limits, permission manifest, host-controlled adapter, deterministic tests. Propose a separate example/module or external package rather than adding a second document engine. |
| Industry templates, rules or input schemas | [Skill developer guide](docs/contributing-skills.md), [skills/](skills/README.md) | Explicit industry/task scope, versioned fields and units, licensed resources, actual consuming tools/helper and positive/refusal tests. A resource file is not a new loader or certified engineering rule; missing runtime integration needs separate review. |
| Geology data rule / knowledge pack | [geology-core.ts](packages/kjdraw-sdk/src/knowledge-packs/geology-core.ts), [knowledge-pack guide](docs/site/pages/knowledge-packs.md), [geology-engineering.ts](packages/kjdraw-sdk/src/geology-engineering.ts) | Licensed, versioned rule with source references; explicit measured versus synthetic facts; unit/continuity/invalid-data tests; independent expected geometry. Compiler/API changes require maintainer review. |
| Drawing layout, labels or hatch mapping | [curated-geology-sheets.mjs](examples/curated-geology-sheets.mjs), [hatch-pattern-catalog.ts](packages/kjdraw-sdk/src/hatch-pattern-catalog.ts), [browser tests](tests/browser/) | Synthetic source-backed sample, geometry/scale assertions, original redistributable pattern data, unchanged-object and resource checks; browser evidence for visible changes. A screenshot alone is not geometry evidence. |
| Independent Skill or agent workflow | [Skill developer guide](docs/contributing-skills.md), [text-audit sample](skills/kjdraw-text-audit/README.md), [mechanical hole pattern](skills/kjdraw-hole-pattern/README.md) | A separate `skills/kjdraw-<topic>/`, supported runtime/tools, input/output contract, short instructions, bilingual human READMEs and reproducible acceptance. Existing-tool reuse needs no core change; new primitives or installer changes require separate review. |
| Documentation or translation | [docs/](docs/), this guide and its [Chinese mirror](CONTRIBUTING.zh-CN.md) | Working paths/commands and accurate capability boundaries; keep English and Chinese meaning aligned. |

The [planner starter](examples/domain-planner-starter/README.md) is runnable through `node --test tests/domain-planner-starter.spec.mjs`. Its sample facts are `center: [0, 0]`, `pitchDiameter: 90`, `holeDiameter: 10`, `count: 6`, all lengths in the host's stated drawing units. It returns six circle intents with pitch radius 45 and hole radius 5. The public plugin adapter performs one transaction; the test covers invalid inputs, entity count, revision, real undo/redo and KJD/DXF reopen. It is a contribution pattern, not a certified engineering design or a tool automatically installed in every agent.

## Domain facts and safety boundaries

- KJDraw edits its own drawings and imported DXF through public SDK commands. Opening a DXF does not automatically recover its design intent, manufacturing tolerance, circuit topology, borehole measurements or the source recipe that generated its lines. Do not infer missing engineering facts from labels, coordinates or a reference image.
- Domain resources contain licensed, versioned semantics and drawing rules, not private project measurements. State which installed tools or helper consume them; the current geology knowledge format is not a universal industry loader. A source recipe retains caller-supplied facts for a particular generated drawing; [geology-drawing-update.ts](packages/kjdraw-sdk/src/geology-drawing-update.ts) is one domain-specific example. Use an actual retained recipe for source-backed revisions, or obtain explicit source input. Editing a displayed equipment tag or hole number does not revise its source identity or relationships.
- State source and drawing units separately when they differ, plus scale, owner/space, exact target identity, optional-field meaning and bounds. Missing data, confirmed empty data and zero are not interchangeable. Preserve unrequested records, IDs, handles, resources and ordering where the contract requires them.
- Do not execute CAD operations by matching prompt keywords, invent measurements, silently fill missing values, approximate unsupported operations, or drop objects on export. The renderer is a projection, not a second document database. UI, plugins and agent hosts share public SDK commands.
- An AI may read and propose; the authorized host/reviewer inspects the exact preview and approves. A proposal is not a completed edit. Do not let a model approve itself, rewrite its arguments invisibly, or claim a session proposal can be approved after restart unless that exact workflow is supported and tested.
- Installing a Skill does not install the CAD runtime. Adding a folder does not automatically register a tool or publish an `npx`-installable package. Runtime dependencies, tool/profile exposure, permissions and release channels need explicit maintainer agreement.

## A copyable first contribution

Paste this task into the domain issue form, or adapt it to your own synthetic daily task. It requires no private drawing or paid provider:

```text
Title: Change one synthetic tag without changing engineering facts
Type: task/fixture regression
Source: original public synthetic data; no customer project; Apache-2.0
Drawing units: millimeter; model space; no retained source recipe
Inputs:
  TEXT id=label-a, text="TAG-A", position=[10,20,0], height=3
  TEXT id=label-b, text="TAG-A", position=[40,20,0], height=3
  LINE id=boundary, start=[0,0,0], end=[100,0,0]
Caller request: change only label-a from exactly "TAG-A" to "TAG-B".
Expected output: one reviewed text edit; label-b remains "TAG-A".
Must preserve: label-a position/height/style/identity; complete label-b
  and boundary records; unrelated resources; supplied source facts, if any.
Before approval: original serialization, revision and history unchanged.
After approval: one committed transaction; one additional undo entry.
Undo: restore the actual original text/geometry; redo: restore approved result.
Save/reopen: write new KJD and DXF, do not overwrite input; independently
  assert both texts, positions, height and boundary geometry after reopening.
  Check IDs/handles according to each format's preservation contract.
Refuse/clarify: missing target identity, unsupported/unknown units, stale
  revision or mismatched expectedText; no partial edit or automatic approval.
Not requested: changing source identities, topology or engineering measurements.
```

For a coding PR, add a small generator/fixture and a focused test under the paths above. Use [agent-text-edit.test.mjs](packages/kjdraw-sdk/test/agent-text-edit.test.mjs) as the native read/propose/approve and preservation reference. Assert geometry and full untouched records, not only the presence of new text. After DXF reopen, compare native semantics within its documented format limits; do not claim that DXF carries the session's approval ledger or undo archive.

Other suitable first issues are a synthetic meter/millimeter mismatch that must fail without changing the drawing, a caller-specified hole pattern, or a licensed symbol/hatch mapping with explicit source values, valid boundaries and unsupported-value refusal tests. Do not infer design facts from labels or copy proprietary libraries. Keep a first PR to one task or one rule.

## Development and verification

Use Node.js 22 or newer. From the repository root:

```sh
npm ci
npm run typecheck
node --test tests/domain-planner-starter.spec.mjs
node scripts/test.mjs
node --no-warnings scripts/build-typescript.mjs --check
node scripts/build-declarations.mjs --check
node scripts/check.mjs
```

Run your focused regression as well. Report which commands actually ran, their exit status, and any unavailable optional checks. A fixture-only check does not establish real-model correctness or a released feature.

Independent DXF checks require Python and pinned `ezdxf`:

```sh
python -m pip install -r scripts/audits/requirements-dxf.txt
python -c "import sys, ezdxf; print(sys.executable); print(ezdxf.__version__)"
```

If multiple interpreters are installed, set `KJDRAW_PYTHON` to that Python executable before running tests (`export KJDRAW_PYTHON=/path/to/python` in a POSIX shell, or `$env:KJDRAW_PYTHON = 'C:\path\to\python.exe'` in PowerShell). Some audit workers use Python isolation: ensure the selected interpreter's environment contains the dependency, not only a different interpreter's user site. A missing dependency or skipped independent test is not a passing interoperability check. See the [DXF corpus audit](scripts/audit-dxf-corpus.mjs) for broader compatibility work.

TypeScript under `packages/kjdraw-sdk/src` is authoritative. Adjacent generated JS is committed because the pinned-source installer executes it directly; declarations under `packages/kjdraw-sdk/types` are also committed. After TS changes, run `npm run build:runtime` and `npm run build:types`, include matching JS and `.d.ts`, and run both drift checks above. Review the diff for unrelated generated changes. Removing generated JS requires a coordinated installer/package migration, not an isolated cleanup.

For page/UI changes, add or update [browser tests](tests/browser/) and run the affected specs in Chromium, Firefox and WebKit. After installing the Playwright browsers, `npm run test:browser -- tests/browser/ai-text-search.spec.mjs` is an example command; choose the spec for your changed behavior and report each engine's actual result. Include mobile layout/overflow checks where relevant. Use `node scripts/serve.mjs` for the playground.

Formatting and lint are introduced only for the listed pilot files. For changes in that scope, run `npm run format:pilot:write`, then `npm run format:pilot:check` and `npm run lint:pilot`; CI checks the same scope. This is not a whole-repository reformat. Add further modules to the gate in small, reviewable steps. Rust work requires stable Rust and the `wasm32-unknown-unknown` target; see [Getting started](docs/getting-started.md).

## Review, licensing and releases

PRs explain the user-visible result and its verification, add tests for changed geometry/transactions/file preservation, and update [capability boundaries](docs/capability-matrix.md) when a limitation changes. Include runtime version, entity/format types, dependencies and asset licenses.

Only submit code and sample files you are entitled to publish under Apache-2.0. Prefer original synthetic fixtures or explicitly authorized, genuinely de-identified redistributable material. Renaming a file is not de-identification. Do not upload private project files, customer coordinates/names, proprietary fonts/templates/symbols/binaries or secrets. Permission to use a private file internally is not permission to publish it; arrange any private review separately with maintainers. AI-assisted changes are welcome when the contributor understands, reviews and tests them; generated output alone is not correctness evidence.

KanJieTeam currently maintains releases. Public SDK changes land here first; downstream products adopt pinned versions after validation. We use semantic versioning and explicit preview/RC tags while the API evolves. Breaking changes require release notes and a migration explanation. External reviewers can become maintainers through sustained, reviewed contributions; there is no automatic commit access. See [GOVERNANCE.md](GOVERNANCE.md) and [SUPPORT.md](SUPPORT.md).

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md), not in a public domain issue.
