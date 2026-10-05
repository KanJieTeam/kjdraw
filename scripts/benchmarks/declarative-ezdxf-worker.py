"""Trusted, bounded JSON-to-ezdxf compiler for generic benchmark drawings.

No model-authored Python, expression, path, import, or file operation is evaluated.
Inputs and outputs are JSON on standard streams; all DXF work is in memory.
"""
import io
import json
import math
import pathlib
import re
import sys

MAX_INPUT_BYTES = 5_000_000
MAX_DXF_BYTES = 4_194_304
MAX_OPERATIONS = 2_048
MAX_FEATURES = 2_048
MAX_VERTICES = 1_024
MAX_ABS_COORDINATE = 1_000_000_000
SCHEMA = "com.kanjie.kjdraw.benchmark.declarative-ezdxf@1"
IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")
KINDS = {"LINE", "CIRCLE", "ARC", "LWPOLYLINE"}
SEED_KINDS = {"lines": "LINE", "circles": "CIRCLE", "arcs": "ARC", "polylines": "LWPOLYLINE"}
REASONS = {
    "DUPLICATE_JSON_KEY", "INVALID_SCHEMA", "INVALID_FEATURE_ID", "INVALID_NUMBER",
    "DEGENERATE_LINE", "INVALID_RADIUS", "INVALID_ARC", "INVALID_POLYLINE",
    "DEGENERATE_POLYLINE", "UNSUPPORTED_ENTITY", "INPUT_BUDGET", "MODEL_JSON_BUDGET",
    "UNSUPPORTED_SCHEMA_OR_UNITS", "OPERATION_BUDGET", "INVALID_RUNTIME_PATH",
    "INITIAL_UNITS", "SEED_BUDGET", "INVALID_SEED", "PREVIOUS_BUDGET",
    "PREVIOUS_CONTRACT", "PREVIOUS_FEATURE_MAP", "INITIAL_KIND", "INVALID_OPERATION",
    "INVALID_ADD", "UNKNOWN_FEATURE", "INVALID_POLAR_ARRAY", "DUPLICATE_FEATURE",
    "UNSUPPORTED_OPERATION", "FEATURE_BUDGET", "DXF_AUDIT_FAILED", "DXF_BUDGET",
}


def pairs_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def exact(value, names):
    if not isinstance(value, dict) or set(value) != set(names):
        raise ValueError("INVALID_SCHEMA")
    return value


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError("INVALID_FEATURE_ID")
    return value


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > MAX_ABS_COORDINATE:
        raise ValueError("INVALID_NUMBER")
    return float(value)


def point(value):
    exact(value, ("x", "y"))
    return (number(value["x"]), number(value["y"]))


def shape(kind, value):
    if kind == "LINE":
        exact(value, ("start", "end"))
        start, end = point(value["start"]), point(value["end"])
        if start == end:
            raise ValueError("DEGENERATE_LINE")
        return {"start": start, "end": end}
    if kind in ("CIRCLE", "ARC"):
        exact(value, ("center", "radius") if kind == "CIRCLE" else ("center", "radius", "startDegrees", "endDegrees"))
        center, radius = point(value["center"]), number(value["radius"])
        if radius <= 0:
            raise ValueError("INVALID_RADIUS")
        result = {"center": center, "radius": radius}
        if kind == "ARC":
            start, end = number(value["startDegrees"]), number(value["endDegrees"])
            if not 0 <= start <= 360 or not 0 <= end <= 360 or (start - end) % 360 == 0:
                raise ValueError("INVALID_ARC")
            result.update(startDegrees=start, endDegrees=end)
        return result
    if kind == "LWPOLYLINE":
        exact(value, ("vertices", "closed"))
        vertices = value["vertices"]
        closed = value["closed"]
        if not isinstance(vertices, list) or len(vertices) < (3 if closed else 2) or len(vertices) > MAX_VERTICES or type(closed) is not bool:
            raise ValueError("INVALID_POLYLINE")
        vertices = [point(item) for item in vertices]
        if any(vertices[index] == vertices[index - 1] for index in range(1, len(vertices))) or (closed and vertices[0] == vertices[-1]):
            raise ValueError("DEGENERATE_POLYLINE")
        return {"vertices": vertices, "closed": closed}
    raise ValueError("UNSUPPORTED_ENTITY")


def add_entity(modelspace, kind, geometry):
    if kind == "LINE":
        return modelspace.add_line(geometry["start"], geometry["end"])
    if kind == "CIRCLE":
        return modelspace.add_circle(geometry["center"], geometry["radius"])
    if kind == "ARC":
        return modelspace.add_arc(geometry["center"], geometry["radius"], geometry["startDegrees"], geometry["endDegrees"])
    return modelspace.add_lwpolyline(geometry["vertices"], close=geometry["closed"])


def set_entity(entity, kind, geometry):
    if kind == "LINE":
        entity.dxf.start = (*geometry["start"], 0)
        entity.dxf.end = (*geometry["end"], 0)
    elif kind == "CIRCLE":
        entity.dxf.center = (*geometry["center"], 0)
        entity.dxf.radius = geometry["radius"]
    elif kind == "ARC":
        entity.dxf.center = (*geometry["center"], 0)
        entity.dxf.radius = geometry["radius"]
        entity.dxf.start_angle = geometry["startDegrees"]
        entity.dxf.end_angle = geometry["endDegrees"]
    else:
        entity.set_points(geometry["vertices"], format="xy")
        entity.closed = geometry["closed"]


def move_entity(entity, dx, dy):
    kind = entity.dxftype()
    if kind == "LINE":
        entity.dxf.start = (number(entity.dxf.start[0] + dx), number(entity.dxf.start[1] + dy), 0)
        entity.dxf.end = (number(entity.dxf.end[0] + dx), number(entity.dxf.end[1] + dy), 0)
    elif kind in ("CIRCLE", "ARC"):
        entity.dxf.center = (number(entity.dxf.center[0] + dx), number(entity.dxf.center[1] + dy), 0)
    else:
        vertices = [(number(x + dx), number(y + dy)) for x, y in entity.get_points("xy")]
        entity.set_points(vertices, format="xy")


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("INPUT_BUDGET")
    envelope = json.loads(raw, object_pairs_hook=pairs_without_duplicates)
    exact(envelope, ("content", "initial", "ezdxfPath"))
    content, initial = envelope["content"], envelope["initial"]
    if not isinstance(content, str) or len(content.encode("utf-8")) > 131_072:
        raise ValueError("MODEL_JSON_BUDGET")
    proposal = json.loads(content, object_pairs_hook=pairs_without_duplicates)
    exact(proposal, ("schema", "units", "operations"))
    if proposal["schema"] != SCHEMA or proposal["units"] != "millimeter":
        raise ValueError("UNSUPPORTED_SCHEMA_OR_UNITS")
    operations = proposal["operations"]
    if not isinstance(operations, list) or len(operations) > MAX_OPERATIONS:
        raise ValueError("OPERATION_BUDGET")
    path = envelope["ezdxfPath"]
    if path is not None:
        if not isinstance(path, str) or not pathlib.Path(path).is_absolute() or not pathlib.Path(path).is_dir():
            raise ValueError("INVALID_RUNTIME_PATH")
        sys.path.append(path)  # Host-supplied dependency path; never read from content.
    import ezdxf

    if not isinstance(initial, dict) or initial.get("units") != "millimeter":
        raise ValueError("INITIAL_UNITS")
    features = {}
    if initial.get("kind") in ("empty", "seed"):
        exact(initial, ("kind", "units") if initial["kind"] == "empty" else ("kind", "units", "features"))
        doc = ezdxf.new("R2018")
        doc.units = 4
        modelspace = doc.modelspace()
        if initial["kind"] == "seed":
            seed = initial["features"]
            if not isinstance(seed, list) or len(seed) > MAX_FEATURES:
                raise ValueError("SEED_BUDGET")
            for item in seed:
                exact(item, ("id", "kind", "shape"))
                feature_id = identifier(item["id"])
                kind = SEED_KINDS.get(item["kind"])
                if feature_id in features or kind is None:
                    raise ValueError("INVALID_SEED")
                features[feature_id] = add_entity(modelspace, kind, shape(kind, item["shape"]))
    elif initial.get("kind") == "previous":
        exact(initial, ("kind", "units", "dxf", "features"))
        dxf, mapping = initial["dxf"], initial["features"]
        if not isinstance(dxf, str) or len(dxf.encode("utf-8")) > MAX_DXF_BYTES or not isinstance(mapping, dict) or len(mapping) > MAX_FEATURES:
            raise ValueError("PREVIOUS_BUDGET")
        doc = ezdxf.read(io.StringIO(dxf, newline=None))
        if doc.dxfversion != "AC1032" or int(doc.header.get("$INSUNITS", 0)) != 4:
            raise ValueError("PREVIOUS_CONTRACT")
        if any(len(layout) for layout in doc.layouts if layout.name != "Model") or any(len(block) for block in doc.blocks if not block.is_any_layout):
            raise ValueError("PREVIOUS_CONTRACT")
        modelspace = doc.modelspace()
        by_handle = {entity.dxf.handle: entity for entity in modelspace}
        if len(by_handle) != len(modelspace) or len(mapping) != len(by_handle) or len(set(mapping.values())) != len(mapping):
            raise ValueError("PREVIOUS_FEATURE_MAP")
        for feature_id, handle in mapping.items():
            identifier(feature_id)
            if not isinstance(handle, str) or handle not in by_handle or by_handle[handle].dxftype() not in KINDS:
                raise ValueError("PREVIOUS_FEATURE_MAP")
            features[feature_id] = by_handle[handle]
    else:
        raise ValueError("INITIAL_KIND")

    before_features = {feature_id: entity.dxf.handle for feature_id, entity in features.items()}
    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError("INVALID_OPERATION")
        op = operation.get("op")
        if op == "add":
            exact(operation, ("op", "id", "kind", "shape"))
            feature_id, kind = identifier(operation["id"]), operation["kind"]
            if feature_id in features or kind not in KINDS:
                raise ValueError("INVALID_ADD")
            features[feature_id] = add_entity(modelspace, kind, shape(kind, operation["shape"]))
        elif op == "set":
            exact(operation, ("op", "id", "shape"))
            feature_id = identifier(operation["id"])
            if feature_id not in features:
                raise ValueError("UNKNOWN_FEATURE")
            entity = features[feature_id]
            set_entity(entity, entity.dxftype(), shape(entity.dxftype(), operation["shape"]))
        elif op == "move":
            exact(operation, ("op", "id", "dx", "dy"))
            feature_id = identifier(operation["id"])
            if feature_id not in features:
                raise ValueError("UNKNOWN_FEATURE")
            move_entity(features[feature_id], number(operation["dx"]), number(operation["dy"]))
        elif op == "delete":
            exact(operation, ("op", "id"))
            feature_id = identifier(operation["id"])
            if feature_id not in features:
                raise ValueError("UNKNOWN_FEATURE")
            modelspace.delete_entity(features.pop(feature_id))
        elif op == "addPolarCircles":
            exact(operation, ("op", "prefix", "center", "pitchRadius", "holeRadius", "count", "startDegrees"))
            prefix, center = identifier(operation["prefix"]), point(operation["center"])
            pitch, radius = number(operation["pitchRadius"]), number(operation["holeRadius"])
            count, start = operation["count"], number(operation["startDegrees"])
            if pitch <= 0 or radius <= 0 or type(count) is not int or not 2 <= count <= 256 or not 0 <= start <= 360:
                raise ValueError("INVALID_POLAR_ARRAY")
            for index in range(count):
                feature_id = identifier(f"{prefix}-{index + 1}")
                if feature_id in features:
                    raise ValueError("DUPLICATE_FEATURE")
                angle = math.radians(start + index * 360 / count)
                center_xy = (number(center[0] + pitch * math.cos(angle)), number(center[1] + pitch * math.sin(angle)))
                features[feature_id] = add_entity(modelspace, "CIRCLE", {"center": center_xy, "radius": radius})
        else:
            raise ValueError("UNSUPPORTED_OPERATION")
        if len(features) > MAX_FEATURES:
            raise ValueError("FEATURE_BUDGET")

    audit = doc.audit()
    if audit.errors or audit.fixes:
        raise ValueError("DXF_AUDIT_FAILED")
    stream = io.StringIO(newline="")
    doc.write(stream)
    dxf = stream.getvalue()
    if len(dxf.encode("utf-8")) > MAX_DXF_BYTES:
        raise ValueError("DXF_BUDGET")
    print(json.dumps({"passed": True, "schema": SCHEMA, "ezdxfVersion": ezdxf.__version__,
                      "units": "millimeter", "dxf": dxf,
                      "features": {feature_id: entity.dxf.handle for feature_id, entity in features.items()},
                      "beforeFeatures": before_features,
                      "entities": len(modelspace)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, ValueError) and str(error) in REASONS else type(error).__name__
        print(json.dumps({"passed": False, "reason": reason}))
        sys.exit(1)
