# DXF compatibility evidence

KJDraw tests its public ASCII DXF adapter against a redistributable synthetic corpus on every CI run. The fixtures cover each declared product target with identical LINE, CIRCLE and TEXT geometry on a named layer.

| Target | Header code | Fixture | Gate |
| --- | --- | --- | --- |
| R14 | AC1014 | `synthetic-r14-core.dxf` | read → validate → write R14 → reopen → semantic audit |
| 2000 | AC1015 | `synthetic-2000-core.dxf` | read → validate → write 2000 → reopen → semantic audit |
| 2004 | AC1018 | `synthetic-2004-core.dxf` | read → validate → write 2004 → reopen → semantic audit |
| 2010 | AC1024 | `synthetic-2010-core.dxf` | read → validate → write 2010 → reopen → semantic audit |
| 2013 | AC1027 | `synthetic-2013-core.dxf` | read → validate → write 2013 → reopen → semantic audit |
| 2018 | AC1032 | `synthetic-2018-core.dxf` | read → validate → write 2018 → reopen → semantic audit |
| 2024 label | AC1032 | `synthetic-2024-core.dxf` | read as AC1032/2018 family → write 2024 target → reopen → semantic audit |

The machine-readable audit records each fixture SHA-256, detected source version, output header, entity/layer counts and round-trip findings. The semantic comparison requires stable CAD handles, entity types, geometry/text payloads and named resource references while allowing generated internal object IDs to differ between imports:

**Identity boundary:** KJDraw's internal entity UUID is stable while editing and reopening the native KJD/KJP document. DXF stores CAD handles, not that UUID; importing the exported DXF can assign new internal UUIDs even when geometry and handles survive. An agent must re-query the reopened DXF and resolve entities by the available handle/geometry before editing; it must not reuse an old KJD UUID across the DXF checkpoint. This is an explicit cross-format limitation, not a ten-round identity guarantee.

```sh
node scripts/audit-dxf-corpus.mjs
node scripts/audit-dxf-corpus.mjs --json
```

This is evidence for the exact public subset, not a claim of all-version or cross-application certification. Binary DXF, DWG, arbitrary proxy/object records, complex plotting resources and font fidelity remain outside this gate. Contributions should add synthetic or clearly redistributable fixtures with provenance, never customer drawings.

LEADER group 340 references preserve live MTEXT, TOLERANCE, or INSERT annotations in the same owner space; a zero handle represents no annotation. Missing, erased, wrong-type, and cross-space targets still block export. This interchange support does not extend the owned native MTEXT pair editing/transform commands to imported tolerance or block annotations. `dxf-leader-reference-types.test.mjs` covers KJD/DXF reopening and an independent ezdxf audit with original synthetic geometry. See the [Autodesk LEADER reference](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-396B2369-F89F-47D7-8223-8B7FB794F9F3.htm).

Imported MTEXT drawing direction (group 72: 1, 3, or 5) and LWPOLYLINE Plinegen flags (group 70, bit 128) survive KJD/DXF reopening and unrelated edits. Changing a polyline's closed state updates only bit 1. Native MTEXT without an explicit flow direction retains its existing default behavior. `dxf-native-display-flags.test.mjs` checks these fields independently with ezdxf. Canvas/SVG projection does not yet implement every vertical/style-dependent text flow or Plinegen rendering rule; preserving these interchange fields is not a guarantee of matching display or plotting. See the [MTEXT](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-5E5DB93B-F8D3-4433-ADF7-E92E250D2BAB.htm) and [LWPOLYLINE](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm) field references.

Layout identity and ownership are covered by `dxf-layouts.test.mjs` and the bidirectional `scripts/audits/dxf-interop.mjs` gate: empty sheets, sparse tab orders, owner references without 410 hints, reactor references, old space blocks and paper geometry. DXF 2000+ writes LAYOUT dictionaries and block-record links, with non-primary paper entities in BLOCKS. Independent ezdxf checks compare sheet names, tab order and actual line endpoints, and require zero audit repairs. Paper/plot settings and viewport fidelity are separate unfinished work.

The page-configuration increment preserves 30 scalar AcDbPlotSettings fields in layout `dxfPlotSettings`, with typed creation and partial `PAGESETUP { dxf: ... }` edits. Native command settings keep their existing contract. The independent `scripts/audits/dxf-page-interop.mjs` gate checks model/populated/empty sheets, physical paper and margins, units/rotation, window/scale, partial edits and history. R12/R14 reject loss of these settings. Layout limits/extents, full viewport fidelity, standalone named page-setup objects, shade-object references, transparency XDATA and external printer/style resources remain unfinished. See the [official field reference](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DXF/files/GUID-1113675E-AB07-4567-801A-310CDE0D56E9.htm).

Native XLINE and RAY interchange is supported for KJDraw's DXF 2000–2024 export targets. Their WCS origins and unit direction vectors preserve infinite-line geometry and the forward sense of rays; KJDraw rejects these exports to R12/R14 under this supported subset. Invalid imported directions remain diagnosed raw-tag proxies. `scripts/audits/dxf-lines-interop.mjs` independently checks model, paper and block ownership, 3D directions, styles, inserted blocks, editing/history and zero ezdxf audit repairs. See the [Autodesk XLINE field reference](https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-DXF/files/GUID-55080553-34B6-40AA-9EE2-3F3A3A2A5C0A.htm).

LEADER annotation interchange resolves a nonzero group 340 to live MTEXT, TOLERANCE or INSERT entities in the same owner space. Group 73 is a creation flag, independently preserved as 0–3; it does not require a current annotation or have to match its current type. A missing or explicitly null 340 remains unassociated without inventing an annotation. Nonzero references to missing, unsupported or cross-owner targets remain diagnosed in KJD and prevent DXF export. `tests/leader-annotation-interop.spec.mjs` independently creates a synthetic fixture, checks two KJD/DXF rounds with ezdxf 1.4.4 and requires zero audit errors or repairs, including an annotated INSERT with attributes. LEADEREDIT and the text grip continue to edit only MTEXT; imported tolerance and block references do not acquire owned text-edit authority. See the [Autodesk LEADER field reference](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-396B2369-F89F-47D7-8223-8B7FB794F9F3.htm).

Omitted LEADER groups 74 and 75 remain omitted after KJD/DXF checkpoints and unrelated text edits. Their native payload values are explicitly `null` to preserve this distinction through JSON; explicit 0/1 source values remain numeric/boolean. A caller's explicit flag edit replaces `null` and is exported. Native-created leaders retain their existing 0/false defaults.
