# DXF cross-implementation gate

KJDraw runs a bidirectional compatibility check against **ezdxf 1.4.4**, an independent open-source DXF implementation:

1. KJDraw writes a layered R2018 drawing containing lines, circles, arcs, bulged polylines, text, an ellipse, a spline, ANSI31/ANSI37 hatches and four dimension types. ezdxf reads it and its auditor must report **zero errors and zero fixes**.
2. Checks verify hatch pattern lines and interior boundaries, ellipse axes, spline knots, and aligned/rotated/radius/diameter measurements. Each dimension must reference a real anonymous block containing its lines, arrowheads and aligned text; an empty placeholder does not pass.
3. ezdxf writes an original fixture with those entities plus a block and insert. KJDraw reads it, moves an imported dimension, writes it, and ezdxf checks both the updated dimension coordinates and its picture block. The unchanged dimensions retain their imported blocks. This direction also requires zero audit errors and fixes.

Run the gate after installing the pinned test dependency:

```sh
python -m pip install ezdxf==1.4.4
node scripts/audits/dxf-interop.mjs
```

The script uses temporary generated files, asserts semantic entity/resource facts and prints SHA-256 evidence. CI recreates the fixtures rather than committing third-party binaries. SDK regressions also cover export-only block name/handle allocation, unchanged document history, stale imported hatch tags after editing, and explicit rejection of unsupported native annotation planes.

This is meaningful cross-implementation evidence for the tested ASCII R2018 subset. It is **not** Autodesk/AutoCAD certification, a lossless promise for arbitrary DXF, binary DXF support or DWG support.
