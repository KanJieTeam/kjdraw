"""Independent reader for the original public native-HATCH fixture only.

Input is bounded by the caller and contains synthetic DXF plus the explicitly
authorized public PAT source. No filenames, private drawing or credentials are
read, and only audit counts are printed.
"""
import io
import json
import math
import sys

import ezdxf
from ezdxf.tools.pattern import parse, scale_pattern

# Node sends UTF-8 JSON over a pipe; Windows' default stdin code page is not
# necessarily UTF-8. Decode explicitly before independently reading the DXF.
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")


def close(actual, expected):
    if isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float))
        assert math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9)
    elif isinstance(expected, (list, tuple)):
        assert len(actual) == len(expected)
        for left, right in zip(actual, expected):
            close(left, right)
    else:
        assert actual == expected


def area(path):
    points = path.vertices
    return abs(sum(points[index][0] * points[(index + 1) % len(points)][1]
                   - points[(index + 1) % len(points)][0] * points[index][1]
                   for index in range(len(points))) / 2)


data = json.load(sys.stdin)
assert data["synthetic"] is True
doc = ezdxf.read(io.StringIO(data["dxf"], newline=None))
hatches = list(doc.modelspace().query("HATCH"))
assert len(hatches) == 2
definitions = parse(data["patSource"])
expected = scale_pattern(definitions[data["name"]], factor=data["scale"], angle=data["degrees"])
for hatch in hatches:
    assert hatch.dxf.pattern_name == data["name"]
    close(hatch.dxf.pattern_scale, data["scale"])
    close(hatch.dxf.pattern_angle, data["degrees"])
    close([[line.angle, tuple(line.base_point), tuple(line.offset), line.dash_length_items]
           for line in hatch.pattern.lines], expected)
    assert hatch.dxf.associative == 1
    assert [path.path_type_flags for path in hatch.paths] == [3, 18]
    for path in hatch.paths:
        assert len(path.source_boundary_objects) == 1
        boundary = doc.entitydb[path.source_boundary_objects[0]]
        assert boundary.get_reactors() == [hatch.dxf.handle]
        assert boundary.dxf.owner == hatch.dxf.owner

hatches.sort(key=lambda hatch: area(hatch.paths[0]), reverse=True)
assert [hatch.dxf.hatch_style for hatch in hatches] == [1, 2]
close([[area(path) for path in hatch.paths] for hatch in hatches], [[30, 1], [20, 0.5]])
for hatch, filled in zip(hatches, [29, 20]):
    actual = sum(area(path) * (1 if path.path_type_flags & 1 or not path.path_type_flags & 16 else -1)
                 for path in hatch.paths.rendering_paths(hatch.dxf.hatch_style))
    close(actual, filled)

hatch = hatches[0]
dictionary = hatch.extension_dict.dictionary
assert dictionary.dxf.owner == hatch.dxf.handle
assert dictionary["SYNTHETIC_DATA"].dxf.owner == dictionary.dxf.handle
assert dictionary["SYNTHETIC_DATA"].tags[0].value == "original public synthetic metadata"
tags = hatch.get_xdata("PUBLIC_NATIVE_HATCH")
assert tags[0].value == "original public synthetic metadata"
references = [tag.value for tag in tags if tag.code == 1005]
assert references == [hatch.paths[0].source_boundary_objects[0], dictionary["SYNTHETIC_DATA"].dxf.handle]
assert hatch.dxf.color_name == "PUBLIC$SYNTHETIC"
assert hatch.dxf.transparency == 33554560
close(hatch.dxf.pixel_size, 0.125)
close(hatch.seeds, [(1, 1)])
audit = doc.audit()
assert len(audit.errors) == 0 and len(audit.fixes) == 0
print(json.dumps({"errors": len(audit.errors), "fixes": len(audit.fixes),
                  "entities": len(list(doc.modelspace())) + len(list(doc.layouts.get("Layout1"))),
                  "hatches": len(hatches), "boundaryLoops": 4, "styles": [1, 2],
                  "lineFamilies": len(expected), "filledAreas": [29, 20],
                  "extensionDictionaries": 1, "xdataApplications": 1}))
