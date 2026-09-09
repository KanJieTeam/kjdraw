# README positioning and Agent drawing context

Date: 2026-09-09. Source candidate: `1.0.0-rc.3`. This record follows the [continuous-editing acceptance](boundary-workflows-2026-09-09.md); its historical results are not overwritten.

## Product introduction

The English and Chinese READMEs now introduce **CAD for people and AI** through editable drawings, a ready-to-use editor, application integration and Agent tooling. The mission is to become the default open-source CAD engine for the AI era; this is a mission, not an achieved ranking.

The npm package introduction and package descriptions use the same positioning. Existing authentic workbench recordings are retained and identified as preset workflows, not recordings of a connected general-purpose model. The README distinguishes the current tools, source-only changes, npm candidates and the future request-to-drawing journey.

## A shipped-source building block, not a model integration

`@kanjieteam/kjdraw/drawing-context` exports `createDrawingContext(document, options)`:

- Read only relevant IDs, native entity types or layers; default to visible model-space entities.
- Preserve units, stable IDs, stored geometry, native orientation, visibility and locking eligibility.
- Read entity and layer pages independently against a fixed document revision.
- Limit JSON UTF-8 response size; omit an oversized geometry as a whole with an explicit reason.
- Return detached, frozen data without editing the document, sending a network request or exposing raw source/resource/custom metadata.

Stored coordinates can be OCS or block-local; this is not a world-coordinate conversion or block-expansion API. The JSON output limit does not bound snapshot memory or query runtime. Hosts own permissions, tool isolation and any disclosure to a model. Spatial queries and real model task orchestration remain on the roadmap.

## Defects found during acceptance

Independent review found that geometry projection originally omitted clockwise HATCH arcs and common orientation fields. Regression cases now preserve HATCH direction, tilted normals/extrusion directions and ellipse/text/INSERT mirror flags.

Compiling the actual guide against an isolated installed package found TS2589 on ordinary `geometry.radius` access: the first API used a deep mapped type over recursive JSON. Explicit readonly public types replace that mapping. Consumer tests check normal field access and reject writes; runtime freezing remains intact.

## Verification

- Node 24.19: **294/294 passed**, no skipped tests.
- Node 22.18: **294/294 passed**, no skipped tests.
- The above include **14 focused context cases**, a packaged pagination example, and the actual English/Chinese context and geometry-review guide snippets.
- README TS/TSX examples are extracted and compiled against the installed artifact. Vue checks compile SFC syntax, original scripts and actual literal props against the public component type; this is not a claim of full `vue-tsc` template checking.
- Strict TypeScript and generation consistency pass for **60 ESM modules, 60 declarations, 36 public entry points**, and **13 bilingual guide pages**. Static build and whitespace checks pass.
- Final affected-browser regression: **24/24 passed** across Chrome and WebKit, covering documentation, framework integration and continuous editing. The earlier full-suite 130-test evidence remains in the preceding acceptance record; this turn did not repeat that entire suite or Firefox.

## Publication

The user resumed GitHub commit/push authorization during this work. This does not authorize npm publication or stable 1.0 tags. The first remote probes failed with connection reset/timeout before authentication; the bundled Git client subsequently reached the expected remote parent `685c1ad82603aabf99802f23dc0e5ff1c0f6ce19`. Local validation does not prove remote delivery or Pages deployment; check the final Git push/Actions result separately.

The next product task is a real host-selected model/tool workflow that reads a drawing, proposes a supported change, obtains user approval and delivers a reopenable editable result. Core CAD editing work continues alongside it.
