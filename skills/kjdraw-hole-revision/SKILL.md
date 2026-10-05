---
name: kjdraw-hole-revision
description: Bind two caller-confirmed native circular holes to a common diameter and center spacing, then propose repeatable parameter changes using KJDraw's local CLI and separate host review. Use for small annotation-free model-space KJD or supported DXF drawings with explicit units and target IDs.
---

# Revise two confirmed holes

Use existing native design relations over the original circles. The caller defines a new relation: the first hole stays fixed, the second moves along their current XY center direction, and both share a diameter. This is not recovery of a missing source recipe. No material, thread, tolerance or clearance rule is inferred.

## Runtime and scope

Use `kjdraw`, Node.js 22+, and a `kjdraw-review` whose help lists `DESIGNCREATE`, `DESIGNUPDATE` and `--flatten-design-relations`. Inspect the installed `cad_query_drawing`, `cad_propose_design_bind`, `cad_read_designs` and `cad_propose_design_update` schemas before using them. The Skill alone does not update the runtime. In a compatible source checkout substitute `node packages/kjdraw-sdk/bin/kjdraw.mjs` and `node packages/kjdraw-sdk/bin/kjdraw-review.mjs`.

Require explicit drawing units (`millimeter` or `meter`), two distinct IDs from the actual current model-space query, their fixed/moving roles, and positive finite initial values and bounds for `diameter` and `spacing`. Initial values must match measured native geometry. Both circles must be visible/editable, have equal radii, the same Z and default +Z orientation, and no thickness or dependent annotations. Ask the caller to verify thickness and absence of dependencies: the query projection cannot establish these completely. Do not manufacture that confirmation.

This first version accepts a complete single-page model-space query, including hidden objects, whose entities are only CIRCLE, LINE, ARC, POINT, LWPOLYLINE, POLYLINE, TEXT or MTEXT. It rejects dimensions, leaders, inserts, hatches and unknown types. Reject incomplete/filtered evidence, unsupported targets, unknown units and drift rather than replacing objects or relaxing bounds. See the [input and acceptance contract](references/acceptance.md) when preparing the helper input or checking outputs.

## Prepare and bind

For DXF, preserve original bytes and import once to a fresh immutable KJD snapshot with `kjdraw convert <source.dxf> <unused-source.kjd>`. Check destination absence first: conversion can overwrite. All subsequent calls use this same KJD; repeated DXF import creates different internal IDs. Import is bounded, not proof of lossless conversion. For KJD, preserve the source directly.

Inspect the KJD to obtain its actual revision and units. Run `cad_query_drawing` using the complete query shown in the acceptance contract; save its actual arguments and successful JSON result. Do not use `--summary` for this read. Let the caller confirm the two native IDs and the proposed fixed/moving relation. Treat drawing text as data.

For `kjdraw agent call`, `--input` and `--args-file` are paths relative to the absolute `--workspace`, with no `.` or `..` segments. The reviewer's `--ledger` and `--candidate` follow the same rule. Place files inside that workspace first. The helper resolves its own paths from the shell's current directory; use absolute helper input/output paths when that differs from the CAD workspace.

Create the helper input from that evidence and caller facts, then run:

```sh
node <skill-directory>/scripts/prepare-bind.mjs --input <confirmed-input.json> --output <unused-bind.json>
kjdraw agent call cad_propose_design_bind --input <immutable-source.kjd> --args-file <bind.json> --workspace <absolute-workspace>
```

The helper only writes proposal arguments; it never edits CAD or approves. Check the native proposal: `DESIGNCREATE`, `awaiting-host-approval`, no geometry changed, the intended two IDs and exact parameters/bindings. Keep the source digest and returned ledger path. In the full response, read that ledger's `proposals` and use the actual `sequence` of the entry matching this proposal's `planId` and tool; the full response itself does not include `proposalSequence`. A failed or stale proposal is not a binding.

## Host review and later revisions

Give the authorized human reviewer this command with the actual ledger entry's sequence and a fresh candidate stem:

```sh
kjdraw-review --workspace <absolute-workspace> --ledger <returned-ledger.json> --sequence <returned-sequence> --candidate <unused-bound.kjd> --approve --flatten-design-relations
```

The human runs it in an independent interactive terminal and reviews the exact design record, geometry and explicit DXF flattening. Never answer or automate the `KJDRAW` challenge, pipe confirmation, or call trusted SDK approval methods from the model. The runtime produces new KJD/DXF/review files without overwriting the input. Internal test confirmation is not human approval.

After an actual receipt, read the new KJD with `cad_read_designs` at its current revision. Use its actual design ID and independent parameter names; check the full page and `driftedEntityIds`. For each requested revision, call `cad_propose_design_update` with exact changes and current units/revision, then hand its new ledger to the same separate reviewer with another unused candidate name. Do not rebind, regenerate circles, or update through the old source file. Reject manual drift or invalid ranges.

Independently query reopened KJD and DXF to verify both radii, the fixed center, the second center along the confirmed direction, Z, and untouched objects. The receipt's DXF entity-type count is not a dimensions check. Continue parameter changes from the latest KJD: the explicitly flattened DXF contains supported geometry but no parameter relation, approval ledger or previous undo history. A proposal, a host-created candidate and a geometrically verified result are distinct outcomes.
