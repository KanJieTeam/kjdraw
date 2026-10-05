"""Independent DXF handle-to-feature check for the frozen token corpus."""
import io
import json
import math
import os
import sys

import ezdxf


def point(value):
    return [float(value[0]), float(value[1])]


def near(a, b):
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(near(x, y) for x, y in zip(a, b))
    return math.isfinite(float(a)) and math.isfinite(float(b)) and abs(float(a) - float(b)) <= 1e-6


def segments(vertices, closed):
    values = [sorted([vertices[i], vertices[i + 1]]) for i in range(len(vertices) - 1)]
    if closed:
        values.append(sorted([vertices[-1], vertices[0]]))
    return values


def matching_segments(expected, actual):
    remaining = actual[:]
    for item in expected:
        index = next((i for i, candidate in enumerate(remaining) if near(item, candidate)), None)
        if index is None:
            return False
        remaining.pop(index)
    return not remaining


def matches(feature, entity):
    kind, shape = feature['kind'], feature['shape']
    if kind == 'lines' and entity.dxftype() == 'LINE':
        expected = sorted([point([shape['start']['x'], shape['start']['y']]), point([shape['end']['x'], shape['end']['y']])])
        actual = sorted([point(entity.dxf.start), point(entity.dxf.end)])
        return near(expected, actual)
    if kind == 'circles' and entity.dxftype() == 'CIRCLE':
        return near([shape['center']['x'], shape['center']['y'], shape['radius']], [*point(entity.dxf.center), float(entity.dxf.radius)])
    if kind == 'arcs' and entity.dxftype() == 'ARC':
        expected = [shape['center']['x'], shape['center']['y'], shape['radius'], shape['startDegrees'] % 360, shape['endDegrees'] % 360]
        actual = [*point(entity.dxf.center), float(entity.dxf.radius), float(entity.dxf.start_angle) % 360, float(entity.dxf.end_angle) % 360]
        return near(expected, actual)
    if kind == 'polylines' and entity.dxftype() == 'LWPOLYLINE':
        actual_vertices = [[float(x), float(y)] for x, y, bulge in entity.get_points('xyb')]
        if any(abs(float(bulge)) > 1e-12 for _, _, bulge in entity.get_points('xyb')):
            return False
        expected_vertices = [[v['x'], v['y']] for v in shape['vertices']]
        return bool(entity.closed) == bool(shape['closed']) and matching_segments(segments(expected_vertices, shape['closed']), segments(actual_vertices, entity.closed))
    return False


def main():
    source = os.environ.get('KJDRAW_FILE_STDIN_PATH')
    with open(source, 'rb') if source else sys.stdin.buffer as stream:
        raw = stream.read(4194305)
    if len(raw) > 4194304:
        raise ValueError('INPUT_TOO_LARGE')
    data = json.loads(raw)
    features, handles = data['features'], data['handles']
    if not isinstance(features, list) or not isinstance(handles, dict) or not isinstance(data['dxf'], str):
        raise ValueError('INVALID_INPUT')
    doc = ezdxf.read(io.StringIO(data['dxf'], newline=None))
    modelspace = {entity.dxf.handle.upper(): entity for entity in doc.modelspace()}
    reasons = []
    for feature in features:
        handle = handles.get(feature['id'])
        if not isinstance(handle, str) or not handle:
            reasons.append('FEATURE_HANDLE_MISSING')
        elif handle.upper() not in modelspace:
            reasons.append('FEATURE_HANDLE_NOT_IN_MODELSPACE')
        elif not matches(feature, modelspace[handle.upper()]):
            reasons.append('FEATURE_HANDLE_GEOMETRY_MISMATCH')
    print(json.dumps({'passed': not reasons, 'reasons': sorted(set(reasons))}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'passed': False, 'reasons': ['IDENTITY_VALIDATOR_UNAVAILABLE']}))
        sys.exit(1)
