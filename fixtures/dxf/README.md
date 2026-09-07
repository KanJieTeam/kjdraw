# Synthetic DXF compatibility corpus

These small ASCII DXF files are original, hand-authored fixtures for KJDraw's public compatibility tests. They contain no customer, project or third-party CAD data and are covered by this repository's Apache-2.0 license.

Each fixture deliberately uses the same minimal geometry on an `AUDIT` layer so version behavior can be compared without unrelated drawing differences. The 2024 label uses Autodesk's `AC1032` header code, which is indistinguishable from the 2018 code inside a DXF file; the audit records both the requested write target and the detected source family.

Run the corpus gate from the repository root:

```sh
node scripts/audit-dxf-corpus.mjs
node scripts/audit-dxf-corpus.mjs --json
```

Passing this corpus proves the declared synthetic subset only. It is not certification for arbitrary DXF files or other CAD applications.
