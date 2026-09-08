"""Independent DXF fixture generator/reader for KJDraw's CI interop gate."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import ezdxf


def generate(path: Path) -> None:
    # Keep the cross-implementation corpus intentional. ``setup=True`` also
    # installs ezdxf's private dimension-arrow blocks, which would add unrelated
    # LWPOLYLINE/SOLID entities to KJDraw's all-owner import assertions.
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4  # millimetres
    document.layers.add("KJ_INTEROP", color=3)
    model = document.modelspace()
    attributes = {"layer": "KJ_INTEROP"}
    model.add_line((0, 0, 0), (120, 35, 0), dxfattribs=attributes)
    model.add_circle((40, 60, 0), radius=12.5, dxfattribs=attributes)
    model.add_arc((95, 65, 0), radius=18, start_angle=20, end_angle=210, dxfattribs=attributes)
    model.add_lwpolyline(
        [(0, 100, 0), (50, 100, 0.35), (70, 125, 0), (0, 125, 0)],
        format="xyb",
        close=True,
        dxfattribs=attributes,
    )
    model.add_text(
        "KJDraw interop",
        dxfattribs={"layer": "KJ_INTEROP", "height": 4, "insert": (10, 145, 0)},
    )
    block = document.blocks.new(name="KJ_MARKER", base_point=(0, 0, 0))
    block.add_circle((0, 0, 0), radius=4, dxfattribs=attributes)
    block.add_line((-6, 0, 0), (6, 0, 0), dxfattribs=attributes)
    model.add_blockref("KJ_MARKER", (150, 75, 0), dxfattribs={"layer": "KJ_INTEROP"})
    document.saveas(path)


def inspect(path: Path) -> dict[str, object]:
    document = ezdxf.readfile(path)
    auditor = document.audit()
    model = document.modelspace()
    counts: dict[str, int] = {}
    for entity in model:
        counts[entity.dxftype()] = counts.get(entity.dxftype(), 0) + 1
    if auditor.has_errors:
        raise AssertionError(f"ezdxf audit found {len(auditor.errors)} errors")
    if counts.get("LINE", 0) < 1 or counts.get("CIRCLE", 0) < 1:
        raise AssertionError(f"expected LINE and CIRCLE in modelspace, got {counts}")
    return {
        "ezdxfVersion": ezdxf.__version__,
        "dxfVersion": document.dxfversion,
        "modelspaceEntities": counts,
        "layers": sorted(layer.dxf.name for layer in document.layers),
        "auditErrors": len(auditor.errors),
        "auditFixes": len(auditor.fixes),
    }


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"generate", "inspect"}:
        raise SystemExit("usage: ezdxf-interop.py <generate|inspect> <path>")
    action, raw_path = sys.argv[1:]
    path = Path(raw_path).resolve()
    if action == "generate":
        generate(path)
        print(json.dumps({"ezdxfVersion": ezdxf.__version__, "generated": str(path)}))
    else:
        print(json.dumps(inspect(path), sort_keys=True))


if __name__ == "__main__":
    main()
