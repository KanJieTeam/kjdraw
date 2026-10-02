# Circular hole pattern

English | [简体中文](README.zh-CN.md)

An independently installable mechanical drafting Skill: turn explicitly supplied hole-layout facts into one reviewable KJDraw polar-array proposal. It uses the same native CAD core as other industries and needs no geological source data, another Skill, domain template or new engine.

## Use

Requirements: a local KJDraw runtime with `cad_propose_drawing_pattern` supporting `polarArrays`, the `kjdraw` and `kjdraw-review` commands, and an agent with terminal access. Native `cad_read_drawing` and `cad_query_drawing` are needed when checking reopened candidate geometry. Inspect installed schemas rather than assuming any release contains these tools. The source runtime requires Node.js 22+; the current Skills CLI requires Node.js 22.20+.

From a checkout, list the package without changing client configuration:

```sh
npx skills add ./skills/kjdraw-hole-pattern --list
```

With permission to change your own client's Skill setup, install this directory:

```sh
npx skills add ./skills/kjdraw-hole-pattern
```

These are optional installation instructions, not actions performed by this sample. Skill and CAD runtime installation are separate. The directory can be used independently of the runtime's bundled `kjdraw-cad` Skill. Repository-shorthand installation is available only after the package reaches the default source; before then use this local path or your own fork. No client configuration, runtime installation or external model service is part of the drawing workflow.

Example request:

> Create only eight equal round holes in a new millimeter drawing. Center: (10,20); pitch-circle diameter: 40; hole diameter: 4. The first hole is at 90 degrees measured counterclockwise from +X. Give me the native proposal for review and preserve the source.

In a KJDraw checkout, `node packages/kjdraw-sdk/bin/kjdraw.mjs` is the equivalent of `kjdraw`; `node packages/kjdraw-sdk/bin/kjdraw-review.mjs` is the equivalent of `kjdraw-review`. See the [Skill instructions](SKILL.md) for the actual seed/array arguments. The example seed is `(10,40)` with radius `2`, not diameter `4`. Native `count: 8` includes this seed and produces exactly eight circles; the first angle is encoded by the seed position, while `angleDegrees: 360` specifies the full sweep.

## Contract

Input: an accessible workspace, a new drawing or local KJD/DXF, center XY, pitch diameter, hole diameter, count, first-hole angle/direction with explicit convention, and drawing units. All lengths use those units. This sample supports millimeters or meters and counts 2–512. Missing units or a first angle are unresolved inputs, not implicit defaults. Invalid counts, nonfinite or nonpositive dimensions, unit mismatch and native coordinate/precision failures are reported without substitute geometry.

Output before approval: one atomic `CREATEBATCH` proposal, a native preview of exactly the requested holes, source revision/digests and a returned review ledger/sequence. No pitch circle, flange body, table, notes, standard thread size or material facts are invented. The circles express geometry, not certified manufacturability, strength or fit.

Existing DXF is imported once into a fresh internal KJD snapshot before the proposal, because independent CLI imports regenerate native object identities and host review reopens its source. Original bytes and the snapshot remain unchanged. The user can still receive DXF; this internal step does not require adopting KJD as their working format. Scratch conversion must target a new file because the generic conversion command can overwrite output. The CLI does not expose evidence of a fully lossless DXF import; preservation applies to original bytes and the supported imported native snapshot.

Output after authorized host review: new `candidate.kjd`, `candidate.dxf` and `candidate.review.json`. The human runs `kjdraw-review` in a separate interactive terminal and reviews its challenge; the model never answers it. All three paths must be unused. Host review checks the exact source/proposal, one native creation transaction, KJD reopening, DXF native type counts and live undo/redo. Hole positions and radii in reopened DXF require the additional native geometry checks in the acceptance cases. KJD native GROUP preservation does not imply GROUP export to DXF; the current DXF adapter does not export these groups. Undo history verified in the live session is not persisted by reopening ordinary candidate files.

## Verify and contribute

The [acceptance cases](references/acceptance.md) define actual count, pitch-radius, hole-radius, orientation, preservation, failure and reopening checks. Run the independently executable repository sample:

```sh
node scripts/validate-community-skills.mjs
node --test tests/community-hole-pattern.spec.mjs
```

The focused tests use public synthetic inputs and real native CLI proposals, host-test review and KJD/DXF reopening. An internal test confirmation is identified as such, not a human approval. These tests establish executable CAD behavior; they do not prove that an untested model followed the Skill. Record a separate actual agent run before making that claim.

Contribute another industry workflow by defining its real input/output and acceptance boundaries and composing existing CAD tools. Source code and these original instructions follow the repository's Apache-2.0 license. This sample contains no customer drawings, licensed mechanical tables or third-party templates.
