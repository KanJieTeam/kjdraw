---
name: kjdraw-sheet-template
description: Create a reviewable model-space drawing frame and title block from an original A4 landscape template, explicit title facts and versioned layer/symbol rules. Use for a blank millimeter CAD drawing; not for certified standards, plotting setup or modifying an existing sheet.
---

# Sheet template

Use the existing KJDraw SDK and host approval controls. This pack supplies resources and a deterministic planner, not a CAD runtime or approval authority.

## Workflow

1. Read [the input/output contract](README.md) and [acceptance boundaries](references/acceptance.md). Load [the original template](assets/a4-landscape.json) and [layer/symbol rules](references/layer-rules.json) through [the helper](scripts/sheet-template.mjs).
2. Confirm a user-selected blank document, its current revision, explicit millimeter units, origin, template ID and all four title facts. Use the template's declared A4 size only when that template is explicitly selected; otherwise require supported explicit dimensions. Never infer project title, drawing number, revision, scale or a symbol position.
3. Call `proposeSheetTemplate` with the document's existing public `KJAgentToolSession`. It compiles the resources and invokes `cad_propose_drawing_annotated`; show the native preview, resources digest and limitations to the user. A pending proposal must not change the drawing or history.
4. Stop for explicit user approval through the host. Never call approval as the model, fabricate an approval actor, execute a pending command or bypass a failed native result. A stale revision requires a fresh read and proposal.
5. After authorized host execution, validate the geometry and layers, then offer DXF export to a new user-chosen destination. Do not overwrite any source. Check undo/redo and reopen exported DXF when claiming those properties.

## Boundaries

Reject nonblank drawings, non-millimeter or missing units, stale revisions, nonfinite/out-of-range dimensions, missing/unknown fields, overflowing single-line text, unsupported or out-of-frame symbols and layer-name collisions. Report errors without retries that alter facts.

The frame is model-space XY geometry, not a paper layout, viewport or configured print sheet. `scaleLabel` is text only; it never rescales geometry. Text fitting is conservative character-width estimation, not verified font metrics. The optional revision triangle is an original example mark, not a regulatory symbol. Do not claim ISO, national, company or other standard certification. No private drawings, licensed third-party templates, provider calls or keys are required.
