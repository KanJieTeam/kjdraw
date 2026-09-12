"""Independent DXF fixture generator/reader for KJDraw's CI interop gate."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf.tools.text import plain_text


DIMENSION_TYPES = {
    0: "ROTATED",
    1: "ALIGNED",
    2: "ANGULAR",
    3: "DIAMETER",
    4: "RADIUS",
    5: "ANGULAR_3_POINT",
    6: "ORDINATE",
}


def vector(value: object) -> list[float]:
    return [float(component) for component in value]


def inspect_hatch(entity: object) -> dict[str, object]:
    pattern = getattr(entity, "pattern", None)
    lines = [] if pattern is None else [
        {
            "angleDegrees": float(line.angle),
            "base": vector(line.base_point),
            "offset": vector(line.offset),
            "dashes": [float(value) for value in line.dash_length_items],
        }
        for line in pattern.lines
    ]
    paths = list(entity.paths)
    return {
        "patternName": str(entity.dxf.pattern_name).upper(),
        "solid": bool(entity.dxf.solid_fill),
        "patternScale": float(entity.dxf.get("pattern_scale", 1.0)),
        "patternAngleDegrees": float(entity.dxf.get("pattern_angle", 0.0)),
        "boundaryPathCount": len(paths),
        "boundaryPathFlags": [int(path.path_type_flags) for path in paths],
        "boundaryVertexCounts": [len(getattr(path, "vertices", ())) for path in paths],
        "patternLines": lines,
    }


def inspect_dimension(entity: object, document: object) -> dict[str, object]:
    dimension_type = int(entity.dimtype)
    points = [vector(entity.dxf.defpoint)]
    if dimension_type in {0, 1}:
        points.extend([vector(entity.dxf.defpoint2), vector(entity.dxf.defpoint3)])
    elif dimension_type in {3, 4}:
        points.append(vector(entity.dxf.defpoint4))
    geometry_name = str(entity.dxf.geometry)
    block = document.blocks.get(geometry_name)
    if block is None:
        raise AssertionError(f"DIMENSION references missing geometry block {geometry_name!r}")
    geometry_counts: dict[str, int] = {}
    geometry_entities = list(block)
    for geometry in geometry_entities:
        geometry_counts[geometry.dxftype()] = geometry_counts.get(geometry.dxftype(), 0) + 1
    if not geometry_entities:
        raise AssertionError(f"DIMENSION geometry block {geometry_name!r} is empty")
    return {
        "type": DIMENSION_TYPES.get(dimension_type, str(dimension_type)),
        "rawType": int(entity.dxf.dimtype),
        "definitionPoints": points,
        "measurement": float(entity.get_measurement()),
        "storedMeasurement": float(entity.dxf.get("actual_measurement", 0.0)),
        "style": str(entity.dxf.dimstyle),
        "geometryBlock": geometry_name,
        "geometryEntityCounts": geometry_counts,
        "geometryLines": [
            {"start": vector(item.dxf.start), "end": vector(item.dxf.end)}
            for item in geometry_entities if item.dxftype() == "LINE"
        ],
        "geometrySolids": [
            [vector(item.dxf.vtx0), vector(item.dxf.vtx1), vector(item.dxf.vtx2), vector(item.dxf.vtx3)]
            for item in geometry_entities if item.dxftype() == "SOLID"
        ],
        "geometryTexts": [
            {
                "insert": vector(item.dxf.insert),
                "alignPoint": vector(item.dxf.get("align_point", item.dxf.insert)),
                "horizontalAlignment": int(item.dxf.get("halign", 0)),
                "verticalAlignment": int(item.dxf.get("valign", 0)),
                "text": str(item.dxf.text),
                "plainText": plain_text(str(item.dxf.text)),
                "height": float(item.dxf.height),
                "rotationDegrees": float(item.dxf.get("rotation", 0.0)),
            }
            for item in geometry_entities if item.dxftype() == "TEXT"
        ],
    }


def inspect_styled_entity(entity: object) -> dict[str, object]:
    result = {
        "type": entity.dxftype(),
        "layer": str(entity.dxf.layer),
        "color": int(entity.dxf.color),
        "trueColor": int(entity.dxf.true_color),
        "linetype": str(entity.dxf.linetype),
        "linetypeScale": float(entity.dxf.ltscale),
        "lineweight": int(entity.dxf.lineweight),
        "visible": not bool(entity.dxf.invisible),
    }
    if entity.dxftype() == "LINE":
        result.update(start=vector(entity.dxf.start), end=vector(entity.dxf.end))
    elif entity.dxftype() == "ARC":
        result.update(
            center=vector(entity.dxf.center),
            radius=float(entity.dxf.radius),
            start=vector(entity.start_point),
            end=vector(entity.end_point),
            startAngleDegrees=float(entity.dxf.start_angle),
            endAngleDegrees=float(entity.dxf.end_angle),
        )
    return result


def assert_styled_geometry(document: object) -> list[dict[str, object]]:
    """Read actual DXF attributes and OCS-derived endpoints, not SDK metadata."""
    entities = [entity for entity in document.modelspace() if entity.dxf.layer == "KJ_STYLES"]
    assert len(entities) == 2, "The elevated styled ARC/LINE pair is missing"
    assert sorted(entity.dxftype() for entity in entities) == ["ARC", "LINE"]
    assert "KJ_INTEROP_DASH" in document.linetypes, "Entity linetype table record is missing"
    summaries = [inspect_styled_entity(entity) for entity in entities]
    expected_style = {
        "layer": "KJ_STYLES", "color": 2, "trueColor": 0x2468AC,
        "linetype": "KJ_INTEROP_DASH", "linetypeScale": 1.5,
        "lineweight": 35, "visible": False,
    }
    for entity in summaries:
        for key, expected in expected_style.items():
            assert entity[key] == expected, f"{entity['type']}.{key}: {entity[key]} != {expected}"
    line = next(entity for entity in summaries if entity["type"] == "LINE")
    arc = next(entity for entity in summaries if entity["type"] == "ARC")
    assert line["start"] == [220.0, 0.0, 6.0]
    assert line["end"] == [220.0, 15.0, 6.0]
    assert arc["center"] == [210.0, 0.0, 6.0]
    assert arc["radius"] == 10.0
    assert arc["startAngleDegrees"] == 180.0
    assert arc["endAngleDegrees"] == 360.0
    for actual, expected in [(arc["start"], [200.0, 0.0, 6.0]), (arc["end"], [220.0, 0.0, 6.0])]:
        assert all(abs(left - right) < 1e-9 for left, right in zip(actual, expected)), (actual, expected)
    return summaries


def generate(path: Path) -> None:
    # Keep the cross-implementation corpus intentional. ``setup=True`` also
    # installs ezdxf's private dimension-arrow blocks, which would add unrelated
    # LWPOLYLINE/SOLID entities to KJDraw's all-owner import assertions.
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4  # millimetres
    document.layers.add("KJ_INTEROP", color=3)
    document.layers.add("KJ_STYLES", color=5)
    document.linetypes.add("KJ_INTEROP_DASH", pattern=[4.0, 3.0, -1.0])
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
    model.add_ellipse(
        (160, 120, 0),
        major_axis=(20, 5, 0),
        ratio=0.4,
        start_param=0,
        end_param=math.tau,
        dxfattribs=attributes,
    )
    spline = model.add_spline(degree=3, dxfattribs=attributes)
    spline.control_points = [(140, 150, 0), (150, 170, 0), (175, 165, 0), (190, 145, 0)]
    spline.knots = [0, 0, 0, 0, 1, 1, 1, 1]
    ansi31 = model.add_hatch(dxfattribs=attributes)
    ansi31.set_pattern_fill("ANSI31", angle=30, scale=2)
    ansi31.paths.add_polyline_path([(0, 180), (80, 180), (80, 240), (0, 240)], is_closed=True, flags=1)
    ansi31.paths.add_polyline_path([(20, 195), (60, 195), (60, 225), (20, 225)], is_closed=True, flags=0)
    ansi37 = model.add_hatch(dxfattribs=attributes)
    ansi37.set_pattern_fill("ANSI37", angle=0, scale=1)
    ansi37.paths.add_polyline_path([(100, 180), (170, 180), (170, 240), (100, 240)], is_closed=True, flags=1)
    model.add_aligned_dim((0, 260), (50, 260), 20, dxfattribs=attributes).render()
    model.add_linear_dim((210, 280), (190, 260), (230, 260), angle=0, dxfattribs=attributes).render()
    model.add_radius_dim((90, 265), mpoint=(100, 265), dxfattribs=attributes).render()
    model.add_diameter_dim((140, 265), mpoint=(130, 265), dxfattribs=attributes).render()
    model.add_text(
        "KJDraw interop",
        dxfattribs={"layer": "KJ_INTEROP", "height": 4, "insert": (10, 145, 0)},
    )
    block = document.blocks.new(name="KJ_MARKER", base_point=(0, 0, 0))
    block.add_circle((0, 0, 0), radius=4, dxfattribs=attributes)
    block.add_line((-6, 0, 0), (6, 0, 0), dxfattribs=attributes)
    model.add_blockref("KJ_MARKER", (150, 75, 0), dxfattribs={"layer": "KJ_INTEROP"})
    styled = {
        "layer": "KJ_STYLES", "color": 2, "true_color": 0x2468AC,
        "linetype": "KJ_INTEROP_DASH", "ltscale": 1.5,
        "lineweight": 35, "invisible": 1,
    }
    model.add_arc((210, 0, 6), radius=10, start_angle=180, end_angle=360, dxfattribs=styled)
    model.add_line((220, 0, 6), (220, 15, 6), dxfattribs=styled)
    document.layouts.new('Sheet 7').add_line((1, 2), (3, 4))
    document.layouts.new('Empty 42')
    document.saveas(path)


def inspect(path: Path) -> dict[str, object]:
    document = ezdxf.readfile(path)
    auditor = document.audit()
    model = document.modelspace()
    counts: dict[str, int] = {}
    for entity in model:
        counts[entity.dxftype()] = counts.get(entity.dxftype(), 0) + 1
    if auditor.has_errors:
        details = "; ".join(str(error.message) for error in auditor.errors)
        raise AssertionError(f"ezdxf audit found {len(auditor.errors)} errors: {details}")
    if auditor.fixes:
        details = "; ".join(str(fix.message) for fix in auditor.fixes)
        raise AssertionError(f"ezdxf audit required {len(auditor.fixes)} fixes: {details}")
    if counts.get("LINE", 0) < 1 or counts.get("CIRCLE", 0) < 1:
        raise AssertionError(f"expected LINE and CIRCLE in modelspace, got {counts}")
    return {
        "ezdxfVersion": ezdxf.__version__,
        "dxfVersion": document.dxfversion,
        "modelspaceEntities": counts,
        "layers": sorted(layer.dxf.name for layer in document.layers),
        "layouts": [{"name": layout.name, "order": layout.dxf.taborder,
                     "types": [entity.dxftype() for entity in layout],
                     "lines": [{"start": vector(entity.dxf.start), "end": vector(entity.dxf.end)} for entity in layout.query('LINE')]}
                    for layout in document.layouts if layout.name != 'Model'],
        "auditErrors": len(auditor.errors),
        "auditFixes": len(auditor.fixes),
        "styledEntities": assert_styled_geometry(document),
        "hatches": [inspect_hatch(entity) for entity in model.query("HATCH")],
        "ellipses": [{
            "center": vector(entity.dxf.center),
            "majorAxis": vector(entity.dxf.major_axis),
            "ratio": float(entity.dxf.ratio),
            "startParameter": float(entity.dxf.start_param),
            "endParameter": float(entity.dxf.end_param),
        } for entity in model.query("ELLIPSE")],
        "splines": [{
            "degree": int(entity.dxf.degree),
            "flags": int(entity.dxf.flags),
            "closed": bool(entity.closed),
            "controlPointCount": len(entity.control_points),
            "controlPoints": [vector(point) for point in entity.control_points],
            "knots": [float(value) for value in entity.knots],
        } for entity in model.query("SPLINE")],
        "dimensions": [inspect_dimension(entity, document) for entity in model.query("DIMENSION")],
    }


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"generate", "inspect"}:
        raise SystemExit("usage: ezdxf-interop.py <generate|inspect> <path>")
    action, raw_path = sys.argv[1:]
    path = Path(raw_path).resolve()
    if action == "generate":
        generate(path)
        verified = inspect(path)
        print(json.dumps({
            "ezdxfVersion": ezdxf.__version__, "generated": str(path),
            "auditErrors": verified["auditErrors"], "auditFixes": verified["auditFixes"],
            "styledEntities": verified["styledEntities"],
        }))
    else:
        print(json.dumps(inspect(path), sort_keys=True))


if __name__ == "__main__":
    main()
