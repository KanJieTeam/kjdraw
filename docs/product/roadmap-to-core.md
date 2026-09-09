# From a usable editor to a dependable CAD foundation

Review date: 2026-09-09. This is an implementation and acceptance plan, not a list of shipped capabilities. See the [detailed CAD workstreams](cad-completeness.md) for feature-level scope.

The [local regression record](regression-2026-09-09.md) separates implemented changes, tested artifacts and remaining gaps during the publication pause.

The subsequent [continuous-editing and geometric-review record](boundary-workflows-2026-09-09.md) tracks the shared UI/Agent workflow and its local acceptance.

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

1. **Completed locally:** curve-editing regression on generated runtime, rebuilt WASM and packed consumers, including group membership, undo and independent DXF reread. See the dated regression record; the publication pause remains in place.
2. **Implemented locally:** boundary-first, repeated TRIM/EXTEND in the Demo and packaged editor, with hover geometry, a public UI-neutral session API and one Undo per completed target. The same preview feeds an existing reviewed Agent plan. Publication remains paused; this completes a bounded editing slice, not the entire drafting stage.
3. Implement native contour joining, lengthening, stretch and polyline vertex insert/remove. Generalize GROUP/saved-selection membership for BREAK/EXPLODE; a split or replacement must not leave an apparently empty assembly or lose a retained fragment.
4. Complete the mechanical drawing acceptance from an empty document before expanding the parts/block and building-plan workflow. File-reopen and measured geometry are required alongside screenshots.

Each slice has a bounded acceptance task. New work does not turn an earlier partial stage into a completed one simply by adding another command.

## AI-era advantage: one editable drawing, one execution path

Advance this track alongside everyday editing, not after the last product stage. A model-specific chat panel is not the API: any host or model should be able to inspect a drawing, propose a typed operation, show the actual change, obtain approval and execute through the same command/history system used by a person.

| Slice | Concrete deliverable | Acceptance |
| --- | --- | --- |
| Geometric review, implemented locally | Public boundary-edit session; immutable TRIM/EXTEND previews; SDK receipt, actual command/arguments and retained-geometry checks; existing one-shot AI plans | Inspect without mutation, reject changed picks and stale previews, approve a circle-to-arc edit, independently undo it, run the flow from the packed package |
| Drawing context for tools, implemented locally | Public `createDrawingContext`: entity IDs/types/layers, units, native geometry and direction fields, visibility/editability, revision-bound independent pagination, UTF-8 output limits and explicit omissions | Packed consumers and actual bilingual guide examples read geometry without mutation; oversized geometry is never shortened into a different shape. Spatial bounds/world-coordinate expansion and a model/tool wrapper remain future work. See the [acceptance record](readme-agent-context-2026-09-09.md). |
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
