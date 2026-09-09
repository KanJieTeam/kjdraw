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

```sh
node scripts/audit-dxf-corpus.mjs
node scripts/audit-dxf-corpus.mjs --json
```

This is evidence for the exact public subset, not a claim of all-version or cross-application certification. Binary DXF, DWG, arbitrary proxy/object records, complex plotting resources and font fidelity remain outside this gate. Contributions should add synthetic or clearly redistributable fixtures with provenance, never customer drawings.

Layout identity and ownership are covered by `dxf-layouts.test.mjs` and the bidirectional `scripts/audits/dxf-interop.mjs` gate: empty sheets, sparse tab orders, owner references without 410 hints, reactor references, old space blocks and paper geometry. DXF 2000+ writes LAYOUT dictionaries and block-record links, with non-primary paper entities in BLOCKS. Independent ezdxf checks compare sheet names, tab order and actual line endpoints, and require zero audit repairs. Paper/plot settings and viewport fidelity are separate unfinished work.
