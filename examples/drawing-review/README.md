# Read-only drawing review

This host example implements the first read-only slice of [RFC #7](https://github.com/KanJieTeam/kjdraw/issues/7): import a drawing, inspect selected native entities, compare two files with explicit identity policy, and open a clickable report. It uses the public KJDraw SDK for import, native objects, validation and SVG export. It adds no CAD parser, geometry authority, model call or mutation tool.

From the repository root with Node 22 or later:

```sh
node examples/drawing-review/demo.mjs work/drawing-review-demo
```

Open `work/drawing-review-demo/report.html`. The original generated sample contains a duplicate line and a zero-length line. Its revision changes a hole and a text label. The page supports filtering, locating findings in the SDK preview, and resetting the preview. All assets are local and the HTML is self-contained.

For an existing drawing:

```sh
node examples/drawing-review/cli.mjs --before A.dxf --after B.dxf --out work/review --units millimeter --scope model --identity semantic
```

`--after` is optional for a single-file check. DWG is not accepted directly: first convert it locally using a trusted host converter, preserve the source, then review the resulting ASCII DXF. DXF bytes are passed to the SDK so its code-page handling remains authoritative. KJD is also supported.

## Explicit host decisions

- `--units millimeter|meter|inch` records the caller's assertion; it does not convert coordinates. A disagreement with the imported units appears in the report.
- `--scope model|all|layout:<exact name>` selects owner spaces. `all` also inspects block definitions in their own coordinates; it does not count expanded INSERT occurrences as additional entities.
- Repeat `--layer <exact layer name>` to narrow checks and entity comparisons. Resource comparison remains global. A missing requested scope/layer fails clearly.
- `--identity semantic` never trusts coincident handles from unrelated files. It first pairs unique exact native semantics, then unique exact geometry (including logical owner) to report changes in properties such as layer or text. A geometry edit that cannot be paired stays unmatched; the report does not guess a correspondence by proximity.
- `--identity same-lineage-handles` additionally pairs unique original DXF source handles, or persisted KJD handles. Use only when the caller knows both files share a CAD lineage. Missing/repeated DXF source handles are not silently treated as unique runtime identities.
- `--window xmin,ymin,xmax,ymax` selects the reviewed owner-coordinate preview window. Omission uses coordinate hints and carries a clipping warning, especially for text, INSERTs and paper viewports. This affects only preview, not analysis scope. SDK-generated rendering can be partial or approximate; omissions and approximations are visible in JSON and HTML.
- `--max-entities 50000` bounds whole-drawing traversal; exceeding it fails, rather than returning a partial clean inventory. `--max-findings 2000` bounds diagnostic groups, and omitted groups are counted explicitly. Defaults are shown here; maximum findings is 10000.
- `--max-normalization-nodes 1000000` bounds native reference/content expansion across the entire drawing, including resource records. Native normalization has a maximum depth of 40. Cyclic, unresolved, ambiguous or over-budget references are reported as unknown and excluded from confident matching and duplicate checks. Anonymous references use native structural contents, so two different XRECORD values cannot collapse to the same unnamed identity.

## Outputs and interpretation

The output directory receives `report.json`, `findings.csv`, `report.html` and numbered before/after SDK SVG files. JSON includes source SHA-256 and bytes, declared/asserted units, full import inventory, selected/excluded counts, native validation, type coverage, diagnostics, unresolved identity groups and SVG coverage. The CSV includes object IDs, handles, logical owners and layer names; cells are quoted and formula-like text is neutralized. Runtime IDs remain useful for locating records in that specific report, but they do not drive cross-file matching.

Re-running a report in the same directory refreshes its regular output files. Before replacing any file, the host checks the complete output set for aliases to either input drawing (including hard links and canonical path aliases), symbolic links, and aliases between report files. Those targets are refused without changing existing outputs. Source paths and filesystem identities are kept in host memory, not serialized in the report.

Each replacement is written to an exclusively created temporary file in the destination directory, then renamed over the destination. It does not truncate an existing inode or follow a destination symlink inserted between the check and rename, so a concurrent link to an input cannot overwrite that input's contents. Use a directory you control: this does not lock directories or stop another process from modifying the source itself. A late filesystem error can leave a partially refreshed report; the report files are not one atomic transaction.

Implemented checks are **exact zero-length LINE** and **exact native duplicate LINE/CIRCLE/ARC/LWPOLYLINE**. Duplicate identity includes layer, style, extension and logical owner. Reversed endpoints, different properties, approximate overlaps and coincident entities in different owners are not automatically called duplicates. Coincidence is a review observation, not permission to delete.

Diffing uses normalized native payloads and extensions, resolves table/block/layout references through logical names, and excludes runtime UUIDs, handles, import source and raw DXF tags. Named native resource changes are reported separately. Unsupported native identity, proxies, ignored opaque tags and document payloads stay explicit. Unmatched records can represent additions/removals **or** changes that cannot be paired safely. No deletion/addition conclusion is inferred from an unmatched record alone.

Resource comparison excludes `entityIds`, `viewportIds` and `tabOrder`: stored resource membership lists and their ordering, and layout tab order, are not compared. Native entity ownership is compared separately. This is not a complete object-graph preservation audit.

The page escapes CAD strings, uses generated filenames and a restrictive Content Security Policy with an exact script hash. It loads no network resource. Inputs, native object graphs, revisions and original plot setups remain unchanged; preview plot settings are applied only to detached document forks.

## Scope of this contribution

This is a usable report example, not a new public SDK contract or automatic repair system. Gaps, self-intersections, dimensions/tolerances, cutting rules, persistent manufacturing recipes, variant batches and reviewed repairs are future RFC stages. A report with no findings means only that the implemented checks found none in the selected scope. It is not manufacturing approval or full DXF fidelity certification.

Run the focused checks with:

```sh
node --test tests/drawing-review.spec.mjs tests/drawing-review-output-safety.spec.mjs
```
