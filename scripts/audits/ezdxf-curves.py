"""Independent native-ARC checks using pinned ezdxf; never invokes KJDraw code."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import ezdxf


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def near(actual: float, expected: float, label: str, tolerance: float = 1e-8) -> None:
    require(math.isfinite(actual) and abs(actual - expected) <= tolerance,
            f"{label}: {actual!r} != {expected!r}")


def inspect(document: object, manifest: dict) -> dict:
    auditor = document.audit()
    require(not auditor.errors, f"DXF audit errors: {auditor.errors!r}")
    require(not auditor.fixes, f"DXF needed repairs: {auditor.fixes!r}")
    require(document.dxfversion == "AC1032", "Expected R2018/AC1032 DXF")
    model = list(document.modelspace())
    arcs = [entity for entity in model if entity.dxftype() == "ARC"]
    lines = [entity for entity in model if entity.dxftype() == "LINE"]
    circles = [entity for entity in model if entity.dxftype() == "CIRCLE"]
    expected = manifest["expected"]
    require(len(arcs) == len(expected), "Missing or unexpected native ARC entities")
    require(len(lines) == manifest["lineCount"], "Finite cutting boundaries changed")
    require(len(circles) == len(manifest["circleBoundaries"]), "Only cutting circles may remain")
    require(len(model) == len(arcs) + len(lines) + len(circles), "Unexpected proxy or other replacement geometry")
    circles_by_handle = {str(entity.dxf.handle).upper(): entity for entity in circles}
    for item in manifest["circleBoundaries"]:
        entity = circles_by_handle.get(item["handle"].upper())
        require(entity is not None, "Circular cutting boundary is missing")
        near(float(entity.dxf.radius), item["radius"], "cutting circle/radius")
        for axis, value in enumerate(entity.ocs().to_wcs(entity.dxf.center)):
            near(value, item["center"][axis], f"cutting circle/center{axis}")
        require(str(entity.dxf.layer) == item["layer"], "Circular cutting boundary layer changed")
    by_handle = {str(entity.dxf.handle).upper(): entity for entity in arcs}
    summaries = []
    for item in expected:
        label = item["label"]
        entity = by_handle.get(item["handle"].upper())
        require(entity is not None, f"{label}: native ARC handle is missing")
        require(str(entity.dxf.layer) == item["layer"], f"{label}: layer changed")
        near(float(entity.dxf.color), item["color"], f"{label}/color")
        near(float(entity.dxf.lineweight), item["lineweight"], f"{label}/lineweight")
        near(float(entity.dxf.ltscale), item["linetypeScale"], f"{label}/linetypeScale")
        extrusion = tuple(float(value) for value in entity.dxf.extrusion)
        require(extrusion == (0.0, 0.0, 1.0), f"{label}: unexpected extrusion {extrusion!r}")
        center = list(entity.ocs().to_wcs(entity.dxf.center))
        for axis in range(3):
            near(center[axis], item["center"][axis], f"{label}/center{axis}")
        radius = float(entity.dxf.radius)
        near(radius, item["radius"], f"{label}/radius")
        # ezdxf interprets group 50/51 as CCW and produces actual WCS vertices.
        # Interior samples distinguish a correct arc from its complementary arc,
        # even when the two endpoint sets are identical.
        angle_span = entity.construction_tool().angle_span
        sample_angles = [float(entity.dxf.start_angle) + angle_span * fraction
                         for fraction in item["sampleFractions"]]
        sample_points = [list(point) for point in entity.vertices(sample_angles)]
        require(len(sample_points) == len(item["samples"]), f"{label}: missing samples")
        max_error = 0.0
        for index, (actual, wanted) in enumerate(zip(sample_points, item["samples"])):
            for axis in range(3):
                near(actual[axis], wanted[axis], f"{label}/sample{index}/{axis}")
                max_error = max(max_error, abs(actual[axis] - wanted[axis]))
        arc_length = radius * math.radians(angle_span)
        near(arc_length, item["arcLength"], f"{label}/arcLength")
        cut_gap_length = None
        if "cutGapLength" in item:
            cut_gap_length = radius * math.radians(360 - angle_span)
            near(cut_gap_length, item["cutGapLength"], f"{label}/cutGapLength", 1e-9)
            near(math.dist(sample_points[0], sample_points[-1]), item["cutChordLength"],
                 f"{label}/cutChordLength", 1e-9)
        summaries.append({"label": label, "handle": str(entity.dxf.handle), "layer": str(entity.dxf.layer),
                          "center": center, "radius": radius, "arcLength": arc_length,
                          "sampleCount": len(sample_points), "maxSampleError": max_error,
                          "cutGapLength": cut_gap_length})
    return {"dxfVersion": document.dxfversion, "auditErrors": len(auditor.errors),
            "auditFixes": len(auditor.fixes), "lineCount": len(lines), "circleCount": len(circles), "arcs": summaries}


def main() -> None:
    require(len(sys.argv) == 4, "usage: ezdxf-curves.py input.dxf expected.json output.dxf")
    require(ezdxf.__version__ == "1.4.4", f"Expected ezdxf 1.4.4, got {ezdxf.__version__}")
    source, manifest_path, output = (Path(value).resolve() for value in sys.argv[1:])
    require(source.parent == manifest_path.parent == output.parent,
            "All audit artifacts must belong to one temporary directory")
    require(source != output and not output.exists(), "Refusing to overwrite an existing audit artifact")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(manifest.get("schema") == "com.kanjie.kjdraw.audit.curve-expectations@1", "Invalid expected-curve manifest")
    document = ezdxf.readfile(source)
    first = inspect(document, manifest)
    document.saveas(output)
    second = inspect(ezdxf.readfile(output), manifest)
    print(json.dumps({"ezdxfVersion": ezdxf.__version__, "input": first, "resaved": second}, ensure_ascii=True))


if __name__ == "__main__":
    main()
