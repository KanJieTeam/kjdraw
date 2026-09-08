# DXF cross-implementation gate

KJDraw runs a bidirectional compatibility check against **ezdxf 1.4.4**, an independent open-source DXF implementation:

1. KJDraw writes a layered R2018 drawing with line, circle, arc, bulged polyline and text entities; ezdxf reads it and its auditor must report zero errors.
2. ezdxf writes an original fixture with those entities plus a block and insert; KJDraw reads and writes it; ezdxf then reads and audits the result again.

Run the gate after installing the pinned test dependency:

```sh
python -m pip install ezdxf==1.4.4
node scripts/audits/dxf-interop.mjs
```

The script uses temporary generated files, asserts semantic entity/resource facts and prints SHA-256 evidence. CI recreates the fixtures rather than committing third-party binaries.

This is meaningful cross-implementation evidence for the tested ASCII R2018 subset. It is **not** Autodesk/AutoCAD certification, a lossless promise for arbitrary DXF, binary DXF support or DWG support.
