# Geology source-fact regression

This is a developer test, not a claim that an AI model can understand arbitrary geology requests. The public synthetic fixtures run in `npm test`. Private project files are optional, read locally, and are never copied into the repository.

The checks cover three distinct boundaries:

1. `tests/geology-fact-rebuild.spec.mjs`: ten cumulative source-fact snapshots each for a borehole log and a section. Every snapshot creates a new reviewed drawing, saves and reopens KJD/DXF, and checks native hatches. Thin intervals and longer revised layer names have public fixtures.
2. `tests/geology-local-corpus-optional.spec.mjs`: imported section DXFs preserve every entity ID and full record through KJD; after DXF export/reimport, every source handle, entity type, geometry, text and hatch field matches after excluding regenerated internal references and DXF tag formatting.
3. `tests/geology-real-mdb-optional.spec.mjs`: the Kanjie read-only MDB adapter supplies current-project borehole facts, preserving its own source references. Each complete hole compiles, is approved, and reopens as KJD/DXF. With stress mode, 20 independent hypothetical changes per hole—including revised depths, boundaries, split and merged intervals—check that proposals contain native hatches and do not modify the original drawing before approval.

PowerShell example (set the paths to your own local project; do not commit the files):

```powershell
$env:KJDRAW_GEOLOGY_DXF_DIR = 'C:\path\to\sections'
$env:KJDRAW_GEOLOGY_MDB = 'C:\path\to\project.mdb'
$env:KJDRAW_KANJIE_SERVER = 'C:\path\to\kanjie\server'
$env:KJDRAW_PYTHON = 'C:\path\to\python.exe'
$env:KJDRAW_GEOLOGY_STRESS = '1'
node --test tests/geology-local-corpus-optional.spec.mjs tests/geology-real-mdb-optional.spec.mjs
```

The source MDB is never altered. A revised layer name, hole depth, or water level in stress mode is **hypothetical** and must not be mistaken for a measured value. A4 labels that cannot fit may use only the versioned style's declared 500 mm continuous sheet, then 841 mm long sheet if necessary; facts and strata are not merged or discarded.

These tests do **not** prove same-document ten-round source-fact editing or real-model instruction-following. Current geology compilers require a blank drawing, and the historical section DXFs do not themselves establish verified interval-to-interval correlations. A safe revision workflow needs a saved, source-backed recipe, explicit interval identities/correlations, reviewable semantic diffs, and one undoable replacement transaction before that claim can be made.
