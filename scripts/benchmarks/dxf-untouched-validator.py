"""Independent, fail-closed DXF preservation check for multi-round CAD trials.

The validator checks every pre-existing handle, including table and block
records, unless the task manifest explicitly permits that handle to change.
New objects and intended target geometry need a separate task-specific scorer.
Internal KJD UUIDs are intentionally not inferred from DXF handles.
"""

import io
import json
import math
import sys

import ezdxf
from ezdxf.lldxf.tagwriter import TagCollector


SCHEMA = "com.kanjie.kjdraw.benchmark.dxf-untouched@1"
MAX_INPUT_BYTES = 16 * 1024 * 1024
MAX_RECORDS = 50000
CRITICAL_HEADER = ("$INSUNITS", "$LTSCALE", "$DIMSCALE", "$TEXTSIZE", "$MEASUREMENT")


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
        return {"bytes": value.hex()}
    if isinstance(value, (list, tuple)):
        return [canonical(item) for item in value]
    # ezdxf Vec2/Vec3 expose coordinates as iterable values. Unknown objects
    # must not be reduced to repr(), which could silently hide a difference.
    if hasattr(value, "__iter__"):
        return [canonical(item) for item in value]
    raise ValueError("unsupported DXF tag value")


def entity_tags(entity, dxfversion):
    writer = TagCollector(dxfversion=dxfversion)
    entity.export_dxf(writer)
    return [(tag.code, canonical(tag.value)) for tag in writer.tags]


def record_map(document):
    records = {}
    for entity in document.entitydb.values():
        handle = entity.dxf.get("handle")
        require(isinstance(handle, str) and handle, "DXF record without handle")
        key = handle.upper()
        require(key not in records, "duplicate DXF handle")
        records[key] = entity_tags(entity, document.dxfversion)
        require(len(records) <= MAX_RECORDS, "DXF record budget exceeded")
    return records


def ezdxf_written_metadata_handle(document):
    """Locate only ezdxf's documented write-time metadata dictionary value."""
    metadata = document.rootdict.get("EZDXF_META")
    if metadata is None or metadata.dxftype() != "DICTIONARY":
        return None
    value = metadata.get("WRITTEN_BY_EZDXF")
    if value is None or value.dxftype() != "DICTIONARYVAR":
        return None
    return value.dxf.handle.upper()


def equal_values(left, right, tolerance):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(left, right, rel_tol=0, abs_tol=tolerance)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            equal_values(a, b, tolerance) for a, b in zip(left, right)
        )
    return type(left) is type(right) and left == right


def equal_tags(left, right, tolerance):
    return len(left) == len(right) and all(
        a_code == b_code and equal_values(a_value, b_value, tolerance)
        for (a_code, a_value), (b_code, b_value) in zip(left, right)
    )


def read_dxf(text):
    require(isinstance(text, str) and text, "nonempty DXF text required")
    require(len(text.encode("utf-8")) <= MAX_INPUT_BYTES, "DXF byte budget exceeded")
    document = ezdxf.read(io.StringIO(text, newline=None))
    auditor = document.audit()
    require(not auditor.errors and not auditor.fixes, "DXF audit reported errors or fixes")
    return document


def validate(payload):
    require(isinstance(payload, dict) and payload.get("schema") == SCHEMA, "invalid schema")
    allowed = payload.get("allowedChangedHandles", [])
    require(isinstance(allowed, list) and all(isinstance(x, str) and x for x in allowed), "invalid allowed handles")
    allowed = [handle.upper() for handle in allowed]
    require(len(allowed) == len(set(allowed)), "duplicate allowed handle")
    tolerance = payload.get("tolerance", 1e-9)
    require(isinstance(tolerance, (int, float)) and not isinstance(tolerance, bool)
            and math.isfinite(tolerance) and 0 <= tolerance <= 0.01, "invalid tolerance")
    before = read_dxf(payload.get("beforeDxf"))
    after = read_dxf(payload.get("afterDxf"))
    require(before.dxfversion == after.dxfversion, "DXF version changed")
    prior = record_map(before)
    current = record_map(after)
    require(set(allowed) <= set(prior), "allowed handle is absent from source")
    # ezdxf writes its own timestamp on every serialization. This one
    # dictionary entry is identified by its root-dictionary path, never by a
    # guessed handle or value pattern. A missing/moved entry is still a change.
    before_written = ezdxf_written_metadata_handle(before)
    after_written = ezdxf_written_metadata_handle(after)
    ignored_volatile = []
    if before_written and before_written == after_written:
        prior.pop(before_written)
        current.pop(before_written)
        ignored_volatile.append(before_written)
    missing = sorted(set(prior) - set(current))
    added = sorted(set(current) - set(prior))
    modified = sorted(
        handle for handle in set(prior) & set(current)
        if not equal_tags(prior[handle], current[handle], tolerance)
    )
    protected_missing = [handle for handle in missing if handle not in allowed]
    protected_modified = [handle for handle in modified if handle not in allowed]
    header_changes = [
        name for name in CRITICAL_HEADER
        if not equal_values(canonical(before.header.get(name)), canonical(after.header.get(name)), tolerance)
    ]
    return {
        "schema": SCHEMA,
        "validator": "ezdxf-independent-untouched",
        "ezdxfVersion": ezdxf.__version__,
        "passed": not (protected_missing or protected_modified or header_changes),
        "beforeRecordCount": len(prior),
        "afterRecordCount": len(current),
        "addedHandles": added,
        "removedHandles": missing,
        "modifiedHandles": modified,
        "unexpectedRemovedHandles": protected_missing,
        "unexpectedModifiedHandles": protected_modified,
        "criticalHeaderChanges": header_changes,
        "ignoredVolatileHandles": ignored_volatile,
        "identityBoundary": "DXF handles only; KJD internal UUID preservation is not scored here",
        "evidenceBoundary": "Target correctness and the legitimacy of allowed handles require an independent task manifest and scorer",
    }


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES * 2 + 1)
        require(len(raw) <= MAX_INPUT_BYTES * 2, "request byte budget exceeded")
        result = validate(json.loads(raw))
    except (ValueError, TypeError, KeyError, ezdxf.DXFError) as error:
        result = {"schema": SCHEMA, "validator": "ezdxf-independent-untouched",
                  "passed": False, "error": type(error).__name__}
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
