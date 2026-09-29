"""Independent full-modelspace comparison against a frozen reference DXF.

This is an offline benchmark primitive, not a CAD equivalence theorem. Both
drawings must use the supported entity subset. Identity handles are ignored;
all other exported entity tags, critical units and layer settings are scored.
The reference DXF must be authored and frozen independently of model outputs.
"""

import io
import json
import math
import sys
from collections import Counter

import ezdxf
from ezdxf.lldxf.tagwriter import TagCollector


SCHEMA = "com.kanjie.kjdraw.benchmark.dxf-reference@1"
MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_DRAWING_BYTES = 16 * 1024 * 1024
MAX_ENTITIES = 2000
MAX_FUZZY_GROUP = 500
SUPPORTED = frozenset((
    "LINE", "CIRCLE", "ARC", "LWPOLYLINE", "TEXT", "MTEXT",
    "HATCH", "ELLIPSE", "SOLID", "POINT",
))
HEADERS = ("$INSUNITS", "$LTSCALE", "$DIMSCALE", "$TEXTSIZE", "$MEASUREMENT")
LAYER_FIELDS = ("color", "linetype", "lineweight", "plot", "flags")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        require(math.isfinite(value), "non-finite DXF number")
        return value
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (list, tuple)) or hasattr(value, "__iter__"):
        return [canonical(item) for item in value]
    raise ValueError("unsupported DXF tag value")


def equal(left, right, tolerance):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(left, right, rel_tol=0, abs_tol=tolerance)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            equal(a, b, tolerance) for a, b in zip(left, right)
        )
    return type(left) is type(right) and left == right


def read_dxf(text):
    require(isinstance(text, str) and text, "nonempty DXF required")
    require(len(text.encode("utf-8")) <= MAX_DRAWING_BYTES, "drawing byte budget exceeded")
    document = ezdxf.read(io.StringIO(text, newline=None))
    audit = document.audit()
    require(not audit.errors and not audit.fixes, "DXF audit reported errors or fixes")
    return document


def entity_signature(entity, version):
    kind = entity.dxftype()
    require(kind in SUPPORTED, "unsupported modelspace entity")
    if kind == "HATCH":
        require(not entity.dxf.get("associative", 0), "associative hatch is not scored")
    writer = TagCollector(dxfversion=version)
    entity.export_dxf(writer)
    tags = writer.tags
    require(tags and tags[0].code == 0, "invalid entity tag sequence")
    # DXF handles and the first owner pointer are transport identity, not
    # geometry. Other 330 tags (for example hatch source references) remain.
    handle_removed = False
    owner_removed = False
    signature = []
    for tag in tags:
        if tag.code == 5 and not handle_removed:
            handle_removed = True
            continue
        if tag.code == 330 and not owner_removed:
            owner_removed = True
            continue
        signature.append([tag.code, canonical(tag.value)])
    require(handle_removed and owner_removed, "entity has no handle or owner")
    layer = str(entity.dxf.get("layer", "0"))
    return kind, layer, signature


def modelspace(document):
    entities = list(document.modelspace())
    require(len(entities) <= MAX_ENTITIES, "entity budget exceeded")
    return [entity_signature(entity, document.dxfversion) for entity in entities]


def match_group(expected, actual, tolerance):
    # A complete exact multiset is the common case for deterministic CAD
    # output and avoids quadratic work for hundreds of repeated symbols.
    key = lambda row: json.dumps(row[2], separators=(",", ":"), ensure_ascii=False)
    if len(expected) == len(actual) and Counter(map(key, expected)) == Counter(map(key, actual)):
        return len(expected)
    require(len(expected) <= MAX_FUZZY_GROUP and len(actual) <= MAX_FUZZY_GROUP,
            "fuzzy matching group budget exceeded")
    neighbors = [
        [index for index, candidate in enumerate(actual)
         if equal(reference[2], candidate[2], tolerance)]
        for reference in expected
    ]
    assigned = {}

    def augment(index, seen):
        for candidate in neighbors[index]:
            if candidate in seen:
                continue
            seen.add(candidate)
            if candidate not in assigned or augment(assigned[candidate], seen):
                assigned[candidate] = index
                return True
        return False

    matched = 0
    for index in range(len(expected)):
        if augment(index, set()):
            matched += 1
    return matched


def compare_entities(expected, actual, tolerance):
    keys = sorted(set((kind, layer) for kind, layer, _ in expected + actual))
    matched = 0
    by_group = []
    for kind, layer in keys:
        left = [row for row in expected if row[:2] == (kind, layer)]
        right = [row for row in actual if row[:2] == (kind, layer)]
        count = match_group(left, right, tolerance)
        matched += count
        if count != len(left) or count != len(right):
            by_group.append({"type": kind, "layer": layer,
                             "missing": len(left) - count, "unexpected": len(right) - count})
    return matched, by_group


def layer_state(document):
    return {
        layer.dxf.name: [canonical(layer.dxf.get(field)) for field in LAYER_FIELDS]
        + [canonical(layer.transparency)]
        for layer in document.layers
    }


def validate(payload):
    require(isinstance(payload, dict) and payload.get("schema") == SCHEMA, "invalid schema")
    tolerance = payload.get("tolerance", 1e-7)
    require(isinstance(tolerance, (int, float)) and not isinstance(tolerance, bool)
            and math.isfinite(tolerance) and 0 <= tolerance <= 0.01,
            "invalid tolerance")
    expected = read_dxf(payload.get("expectedDxf"))
    actual = read_dxf(payload.get("actualDxf"))
    require(expected.dxfversion == actual.dxfversion, "DXF versions differ")
    expected_entities = modelspace(expected)
    actual_entities = modelspace(actual)
    matched, mismatches = compare_entities(expected_entities, actual_entities, tolerance)
    expected_layers = layer_state(expected)
    actual_layers = layer_state(actual)
    layer_mismatch = sorted(
        name for name in set(expected_layers) | set(actual_layers)
        if not equal(expected_layers.get(name), actual_layers.get(name), tolerance)
    )
    header_mismatch = [
        name for name in HEADERS
        if not equal(canonical(expected.header.get(name)),
                     canonical(actual.header.get(name)), tolerance)
    ]
    return {
        "schema": SCHEMA,
        "validator": "ezdxf-independent-reference",
        "ezdxfVersion": ezdxf.__version__,
        "passed": not (mismatches or layer_mismatch or header_mismatch),
        "expectedEntities": len(expected_entities),
        "actualEntities": len(actual_entities),
        "matchedEntities": matched,
        "entityMismatches": mismatches,
        "layerMismatches": layer_mismatch,
        "criticalHeaderChanges": header_mismatch,
        "identityBoundary": "DXF handles and owner pointers are ignored; KJD UUID preservation requires a separate check",
        "coverageBoundary": "Only supported modelspace entity types, critical header fields and layer settings are compared; blocks, dimensions, paper space, styles and relationships need additional scorers",
    }


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        require(len(raw) <= MAX_INPUT_BYTES, "request byte budget exceeded")
        report = validate(json.loads(raw))
    except (ValueError, TypeError, KeyError, RecursionError, ezdxf.DXFError) as error:
        report = {"schema": SCHEMA, "validator": "ezdxf-independent-reference",
                  "passed": False, "error": type(error).__name__}
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
