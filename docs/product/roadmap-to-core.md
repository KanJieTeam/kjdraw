# KJDraw delivery programme

Review date: 2026-09-09. This is an implementation and acceptance plan, not a list of shipped capabilities. See the [detailed CAD workstreams](cad-completeness.md) for feature-level scope.

## One programme, explicit evidence

This is the master delivery plan for the CAD application, SDK and AI tools. The CAD workstream IDs below link to the detailed implementation checklist; the [release matrix](../KJDRAW_1_0_ACCEPTANCE_MATRIX.json) governs stable promotion, not feature completeness. Historical acceptance reports are evidence at their recorded commit, not current publication status.

Each delivery item advances through **planned → implemented → accepted → published**. Record its source commit, remaining scope, tests, affected consumers and first published package version. A passing core test does not establish UI availability; a deployed Demo does not establish npm availability. No overall percentage is inferred from command or test counts.

The [local-corpus and loading record](local-corpus-acceptance-2026-09-09.md) now supplies concrete W05/W07/W11 priorities: layout/ownership loss and missing HATCH rendering first, large-document import and bounded Agent working sets next. Encoding/whitespace and handle-index fixes are accepted in source; comparative speed and complete private-drawing fidelity are not. Use the [opt-in browser protocol](../benchmarks/browser-load-comparison.md) for subsequent measurements.

### Workstreams

| ID | Deliverables | Current position | Acceptance |
| --- | --- | --- | --- |
| W01 Distribution | Exact-commit CI, source/npm/Demo/Docs alignment, generated TS/JS parity, immutable release evidence | In progress: latest inspected public npm channel is older than the source; Firefox subpixel assertion corrected and the focused test passes in three browsers | Actual installed package completes documented examples; release and deployment artifacts match the accepted source |
| W02 Construction and precision | G01–G10, P01–P04: native drawing primitives, curve construction, coordinates, snaps, tracking and units | Partial; basic construction and coordinate entry exist | Construct dimensioned profiles from points and exact input; independently check geometry |
| W03 Editing and topology | S01–S04, M01–M09: selection, transforms, arrays, offset, trim/extend, fillet/chamfer, break/join/explode, stretch and vertices | Partial; continuous curve boundary editing exists, advanced topology remains | Draw and reshape a mechanical profile; cancel, undo, redo and reopen without lost geometry or references |
| W04 Drawing resources | A01–A03, L01–L02, B01–B02: layers, text, dimensions, hatches, blocks, attributes and licensed parts | Partial; core records are not complete editing workflows | Build a plan from reusable parts; update instances, styles and dimensions and reopen |
| W05 Files and output | F01–F04, O01–O02: uniform file actions, recovery, external DXF fixtures, paper/viewport/scale, PDF/SVG/image output; separate DWG provider track | Partial; native formats/history and bounded DXF exist, production output remains | Save/recover a project and produce a measured A3 sheet at explicit scale |
| W06 Design relationships | Stable object identity, named parts, parameters, edge offsets, symmetry and dependency updates; later general constraints | Planned beyond existing IDs and object records | Widen a mounting plate while retaining specified hole-edge distances and updating annotations |
| W07 CAD agent tools | Versioned tool definitions and runtime validation, explicit units/coordinates, bounded context, task-sized operations and useful errors | Source supports read/page/measure, mixed LINE/CIRCLE/ARC/LWPOLYLINE drawing proposals and moves with before/after geometry and host-only approval. Live-provider acceptance, dimensions and richer editing tools remain | Discover tools without reading internals; query, propose and validate supported geometry |
| W08 Real AI execution | Real model loop, clarification, geometric checks, reviewed application, bounded correction, retry/deduplication, cancellation and resume | Bounded proposal runner implemented in source; live-model tasks, durable recovery and complete part workflows remain | Real model creates, revises, validates and saves a part; reject a proposal and exercise failure recovery |
| W09 Provider/framework/harness adapters | One tool source; direct SDK, MCP and CLI entrances; provider schema/result adapters; session, file, permissions and approval integration | Four wire adapters, custom model bridge and opt-in CLI example implemented in source; live endpoint certification, MCP server and framework convenience packages remain | The same task corpus runs with multiple tested models and two host environments without separate CAD implementations |
| W10 Workbench and embedding | U01–U03, E01–E03: shared theme/layouts, usable panels, shortcuts, accessibility, Vanilla/React/Vue parity, customization and Kanjie downstream checks | Partial; three layouts and packaged adapters exist | Independent consumers embed and customize without copying workbench source; common fixes reach every consumer |
| W11 Reliability and global documentation | Q01–Q03: mixed-drawing performance, input fuzzing, resource budgets, model-data permissions, bilingual versioned guides, fonts/Unicode/units | Partial; baseline tests, input budgets and docs exist | Named hardware/fixtures, measured latency and memory, malicious-input cases, reproducible guide examples |
| W12 Ecosystem and modelling | Industry samples, independent integrations, plugin contributions, task evaluations, maintained releases; X01 parametric sketches, BRep and assemblies | Partial samples/governance; external adoption and general modelling remain | External users complete tasks and ship integrations; modelling features have independent geometric acceptance |

### Delivery stages

| Stage | Work in parallel | Exit condition |
| --- | --- | --- |
| A — Trusted baseline | W01 plus W07 interface design | Complete CI passes; installation/deployment differences are explicit and the accepted candidate can be reproduced |
| B — Complete part workflow | W02/W03/W06 plus W07/W08 model-neutral task execution; DeepSeek is an economical test option, not a dependency | Empty drawing → dimensioned part → language-driven revision → numeric checks → save/reopen, across varied inputs |
| C — General application | W04/W05/W10 plus W09 | Mechanical, building and site tasks; reusable parts and output; real cross-model/host tests |
| D — Candidate acceptance | W01/W08/W11 with independent users | Three clean framework integrations, complete browser runs, failures/recovery, measured AI task corpus |
| E — Stable release | W01/W12 | Explicit maintainer promotion of the exact accepted artifact, with matching Docs/Demo and public tested scope |
| F — Broader leadership | W06/W09/W11/W12 | Larger tasks, interoperability, reliable modelling and sustained independent adoption |

Milestones are evidence-based, not promised dates. The target is global leadership in dependable, embeddable, AI-usable CAD; no ranking or guaranteed community response is asserted.

### Proposed 1.0 user acceptance

- Mechanical, building and site drawings completed from empty documents, including modification, native save/reopen and measured output within the published scope.
- The same workflows in clean Vanilla/React/Vue consumers, without copied workbench source.
- At least three actually tested model configurations spanning domestic and international providers, and two host environments. Target adapters are not advertised as supported until their task results exist.
- A versioned corpus of at least 30 AI tasks, with repeated runs per model/configuration. Proposed standard-task completion target: 95%; also report geometric correctness, attempts, cost, latency, interventions and failures. This is a target, not a current result.
- No known release-blocking data loss, silently incorrect committed geometry or duplicate-execution defect in the accepted scope; complete CI and exact published-artifact checks.
- Independent developers and drawing users complete onboarding and tasks without maintainer coaching. General BRep, assemblies, unrestricted DWG and device-certified printing remain separate tracks rather than implied 1.0 features.

The runtime owns identity, file/model permissions and approvals. Drawing text is untrusted data, not an instruction. Models may propose changes but must not manufacture their own approval. Keep vendor dependencies outside the CAD core and give every adapter the same tool semantics.

Model coverage is protocol- and capability-based, not a fixed vendor allowlist. The source now provides Responses, Chat Completions-compatible, Claude Messages and Gemini GenerateContent adapters, a custom model interface and a bounded proposal runner. DeepSeek is an optional low-cost evaluation target. Protocol-fixture acceptance does not establish live model quality; record each tested endpoint/model/configuration separately. MCP servers and framework-specific convenience packages remain separate deliverables.

The [local regression record](regression-2026-09-09.md) separates implemented changes, tested artifacts and remaining gaps during the publication pause.

The subsequent [continuous-editing and geometric-review record](boundary-workflows-2026-09-09.md) tracks the shared UI/Agent workflow and its local acceptance.

The [starter-tool acceptance record](agent-tools-acceptance-2026-09-09.md) covers model-neutral tools, installed consumers, bilingual search and distribution auditing. Real model/provider integration remains a separate acceptance step.

The [multi-model acceptance record](multi-model-acceptance-2026-09-09.md) covers four protocol adapters, a custom model interface, bounded execution and their package/browser tests. Live-model task evaluation remains open.

## Product decision

KJDraw is not yet ready to claim leadership over established CAD products. Passing the current regression suite validates the tested subset; it does not validate missing workflows, arbitrary imported drawings, production plotting or an unmeasured large-drawing workload.

The opportunity is a **complete, embeddable CAD workbench backed by an open, scriptable document engine**. A user should finish a drawing without editing source code; a developer should embed the same editor, then replace only the UI or services their product needs. Human and agent edits should share geometry, transactions, file handling and undo.

Browser delivery and an AI panel alone are not a differentiator. The defensible product must combine dependable editing, practical interoperability, straightforward integration, extensibility and trustworthy maintenance.

## Delivery sequence and acceptance

| Stage | Deliverable | Current gap | Acceptance task |
| --- | --- | --- | --- |
| 1. Everyday editing | Trim lines, arcs and circles; extend lines and arcs; boundary-first repeat editing; joining, lengthening, stretch and polyline vertex operations; full snapping/tracking controls | Curved edits, TRIM memberships, clockwise DXF arcs and stable circle intersections are implemented locally; see the regression record for exact artifact verification. The remaining operations are not complete. | Start empty: draw a mechanical mounting profile, trim curved corners, join the contour, create a bolt circle, reshape a local section, dimension it, undo/redo and reopen it. |
| 2. Reusable drawings | Block creation, insertion, transformation and explode; instance attributes; a small documented parts library; complete layer, text and dimension properties | Core block records/commands exist, but that is not an end-user block editor. Text content editing exists; height, rotation, alignment and multiline tools need completion. | Build a room plan from reusable doors/windows; change one instance's attributes, edit a definition, verify affected instances, export and reopen in another reader. |
| 3. Production output and files | Model/paper workflows, physical page size, plotting scale, preview, PDF/SVG/image output; font fallback; broader external DXF corpus; recovery and project-file parity | Paper/viewport records are not a print product. Demo Snapshot is a project-version snapshot, not image/PDF export. Demo KJP and embedded DXF/KJD workflows differ. | Produce an A3 sheet at an explicit scale; measure the exported geometry and lineweights, verify fonts/dimensions, reopen the source, recover an interrupted session. |
| 4. A reusable application kit | Equivalent Vanilla/React/Vue behaviour; typed options/events/commands; controlled toolbar and panel composition; accessible bilingual workflows; stable package boundaries | The adapters and shared theme exist, but every new tool and file workflow still needs consumer-level parity checks. Demo-only patches do not complete a feature. | Install the actual package in three clean applications. Complete the same drawing with no copied workbench source; switch layouts and documents, customize one panel, cleanly unmount/remount. |
| 5. Scale and adoption | Reproducible performance corpus; progressive load/cancellation; memory/recovery tests; plugin examples; task-oriented agent integration; maintainer and compatibility process | A 10k core benchmark is not evidence of smooth 100k/1m interactive editing. A scripted agent showcase is not a general-purpose CAD assistant. External adoption has not been established. | Replay the same operations on named hardware with 10k and 100k mixed entities; report load time, interaction p95, memory and failure cases. Then have independent developers integrate a plugin and real users finish drawings without maintainer intervention. |

Stages are ordered by dependencies, not promised dates. Documentation, accessibility, regression tests and framework parity advance with each feature rather than waiting for the final stage. DWG requires a separately chosen, licensed and independently tested provider; no DWG capability is implied by DXF support.

### Next implementation slices

1. **Accepted in source:** curve-editing regression on generated runtime, rebuilt WASM and packed consumers, including group membership, undo and independent DXF reread. Source publication resumed; check npm separately with `npm run audit:distribution`.
2. **Accepted in source:** boundary-first, repeated TRIM/EXTEND in the Demo and packaged editor, with hover geometry, a public UI-neutral session API and one Undo per completed target. The same preview feeds an existing reviewed Agent plan. This completes a bounded editing slice, not the entire drafting stage or npm release.
3. Implement native contour joining, lengthening, stretch and polyline vertex insert/remove. Generalize GROUP/saved-selection membership for BREAK/EXPLODE; a split or replacement must not leave an apparently empty assembly or lose a retained fragment.
4. Complete the mechanical drawing acceptance from an empty document before expanding the parts/block and building-plan workflow. File-reopen and measured geometry are required alongside screenshots.

Each slice has a bounded acceptance task. New work does not turn an earlier partial stage into a completed one simply by adding another command.

## AI-era advantage: one editable drawing, one execution path

Advance this track alongside everyday editing, not after the last product stage. A model-specific chat panel is not the API: any host or model should be able to inspect a drawing, propose a typed operation, show the actual change, obtain approval and execute through the same command/history system used by a person.

| Slice | Concrete deliverable | Acceptance |
| --- | --- | --- |
| Geometric review, implemented locally | Public boundary-edit session; immutable TRIM/EXTEND previews; SDK receipt, actual command/arguments and retained-geometry checks; existing one-shot AI plans | Inspect without mutation, reject changed picks and stale previews, approve a circle-to-arc edit, independently undo it, run the flow from the packed package |
| Drawing context for tools, implemented locally | Public `createDrawingContext`: entity IDs/types/layers, units, native geometry and direction fields, visibility/editability, revision-bound independent pagination, UTF-8 output limits and explicit omissions | Packed consumers and actual bilingual guide examples read geometry without mutation; oversized geometry is never shortened into a different shape. Spatial bounds/world-coordinate expansion remain; starter tool wrappers and model adapters are now implemented separately. See the [acceptance record](readme-agent-context-2026-09-09.md). |
| A real task-oriented host integration | A model-neutral tool adapter and one complete mechanical or building-plan task, with actionable validation errors and user-controlled approval | Run with a real host-selected model, review the actual proposed geometry, reject one proposal, accept another, reopen the result; do not count canned intent parsing as model integration |
| Third-party tools and operations | Documented extension examples using the same query, transaction, preview, receipt and undo concepts | An independent developer adds a domain operation without forking the renderer or embedding private Kanjie industry code |

The new trim/extend preview is not a universal preview engine for every command. Expand previews as geometry operations are implemented and tested. Authentication, service authorization, model credentials and approval persistence remain host responsibilities; local preview identity and argument digests are correctness checks, not a sandbox or cryptographic authorization boundary.

## Regression requirements for every editing feature

1. Real toolbar, keyboard and canvas actions work in the Demo and the packaged editor, in English and Chinese.
2. Numeric tests verify endpoints, curve sweep, topology and measurements, not only entity counts or screenshots.
3. Selection, layer protection, wrong inputs, cancellation, repeated commands, pointer ownership and drawing/revision changes are exercised.
4. Each completed edit is one undo step; Undo/Redo and native-file reopen preserve the intended data. A type conversion creates a derived entity without breaking immutable identity rules.
5. DXF geometry is checked through an independent reader. For circular arcs, compare interior points and sweep as well as endpoints: the wrong complementary arc has the same endpoints.
6. Layouts are checked at common desktop sizes and narrow widths, with long bilingual labels, visible focus, no overlapping hit targets and no accidental camera refits.
7. The public API example is compiled against the packed artifact. CI and generated reference checks detect source/docs drift.

## What makes the project worth adopting

| Intended advantage | Existing foundation | Evidence still needed |
| --- | --- | --- |
| Use the editor immediately; customize it incrementally | Shared workbench, Precision theme, three layouts, Vanilla/React/Vue adapters | Independent clean integrations and full production-workflow parity |
| Automate the same editable drawing a person sees | Typed document model, commands, transactions, undo and reviewed agent plans | Useful non-scripted host integrations, explicit error/recovery UX, contributed tools |
| Keep deployment a host choice | Browser operation and provider boundaries | Documented, tested local/self-hosted/service-assisted examples without hidden dependencies |
| One core for open source and Kanjie products | Shared SDK modules and explicit open-source boundary | A downstream adapter test that prevents the core and Kanjie from drifting; domain-specific MDB/report/template code stays outside the generic core |
| Be maintainable beyond the original author | TypeScript ownership, generated declarations, tests and contribution docs | Compatibility policy, focused extension points, reproducible issue fixtures and external maintainers |

## Stable 1.0 decision

Do not use a star target, an export count or an attractive recording as the release gate. Before stable 1.0, the accepted 2D scope must complete the mechanical, building-plan and site-drawing journeys; critical data-loss/editing bugs must be closed; the exact installed artifact and independent integrations must pass acceptance.

Community response cannot be guaranteed. Evidence of becoming a core project comes from repeat users, independently shipped integrations, useful third-party extensions, reproducible reliability and contributions that can be maintained without the original team rewriting them.

## Beyond the 2D foundation

The long-term CAD-core ambition also requires a separately designed constraint solver, parametric history, robust BRep topology and interoperable geometry backends. The kernel choice needs an architecture decision, dependency/license review and independent precision/topology tests. A box boolean or mesh preview is not evidence of that capability. This programme must preserve the same document/command and extension boundaries rather than creating an unrelated second product, but it must not delay or be falsely included in the accepted 2D 1.0 scope.

## 当前执行约束

用户已于 2026-09-09 恢复 GitHub 提交与推送授权。此前暂停期的验收记录保留其历史状态；当前通过回归的源码与文档可以推送。npm 发布、正式版标签和稳定 1.0 晋级仍未授权，不随 Git 推送执行。先补齐可完成的 CAD 工作流，再按上述阶段验收；已通过某项测试不等于该阶段全部完成。
