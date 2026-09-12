"""Independent ezdxf checks for the original installation-plate benchmark contract.
This checks native engineering evidence, not structural adequacy or visual readability.
"""
import io
import json
import math
import os
import sys
import ezdxf


def near(a, b, tolerance=1e-6):
    if isinstance(a, (list, tuple)):
        return isinstance(b, (list, tuple)) and len(a) == len(b) and all(near(x, y, tolerance) for x, y in zip(a, b))
    if isinstance(a, str):
        return a == b
    return isinstance(b, (int, float)) and math.isfinite(a) and math.isfinite(b) and abs(a-b) <= tolerance


def point(value):
    return [float(value[0]), float(value[1]), float(value[2])]


def segment(a, b, layer):
    return ['LINE', layer, *sorted([point(a), point(b)])]


def geometry(kind, payload, layer):
    if kind == 'LINE':
        return [segment(payload['start'], payload['end'], layer)]
    if kind == 'CIRCLE':
        return [['CIRCLE', layer, point(payload['center']), payload['radius']]]
    if kind == 'ARC':
        return [['ARC', layer, point(payload['center']), payload['radius'], payload['startAngle'] % 360, payload['endAngle'] % 360]]
    vertices = payload['vertices']
    return [segment(vertices[i], vertices[(i+1) % len(vertices)], layer) for i in range(len(vertices) if payload['closed'] else len(vertices)-1)]


def validate(dxf, expected):
    doc = ezdxf.read(io.StringIO(dxf, newline=None))
    audit = doc.audit()
    result = {'passed': False, 'unitsCorrect': doc.header.get('$INSUNITS', 0) == 4,
              'auditErrors': len(audit.errors), 'auditFixes': len(audit.fixes), 'entities': len(doc.modelspace())}
    def fail(reason):
        return {**result, 'reason': reason}
    if doc.dxfversion not in ('AC1027', 'AC1032'):
        return fail('CONTRACT_REQUIRES_R2013_OR_NEWER')
    if not result['unitsCorrect'] or audit.errors or audit.fixes:
        return fail('UNITS_OR_ZERO_REPAIR_AUDIT_FAILED')
    if not near(float(doc.header.get('$LTSCALE', 1)), 1):
        return fail('GLOBAL_LINETYPE_SCALE')
    if any(len(layout) for layout in doc.layouts if layout.name != 'Model'):
        return fail('EXTRA_PAPER_GEOMETRY')
    dims = [e for e in doc.modelspace() if e.dxftype() == 'DIMENSION']
    dim_blocks = {e.dxf.get('geometry', '') for e in dims}
    for block in doc.blocks:
        if block.is_any_layout or not len(block):
            continue
        if block.name not in dim_blocks or not block.name.startswith('*D'):
            return fail('EXTRA_NON_DIMENSION_BLOCK')
        if any(e.dxftype() not in ('LINE', 'SOLID', 'TEXT', 'MTEXT', 'ARC', 'POINT', 'INSERT') for e in block):
            return fail('UNSUPPORTED_DIMENSION_BLOCK_CONTENT')
        # Nested INSERTs could smuggle arbitrary geometry past model-space checks.
        if any(e.dxftype() == 'INSERT' for e in block):
            return fail('NESTED_DIMENSION_BLOCK_INSERT')
    for layer in expected['layers']:
        if layer['name'] not in doc.layers:
            return fail('MISSING_REQUIRED_LAYER')
        native = doc.layers.get(layer['name'])
        if native.is_off() or native.is_frozen() or native.is_locked() or native.dxf.lineweight != layer['lineweight']:
            return fail('LAYER_VISIBILITY_OR_LINEWEIGHT')
        linetype = doc.linetypes.get(native.dxf.linetype)
        tags = linetype.pattern_tags.tags
        pattern = [float(tag.value) for tag in tags if tag.code == 49]
        if not near(layer['pattern'], pattern):
            return fail('LAYER_DASH_PATTERN')
    shapes, actual_dims, notes = [], [], []
    for entity in doc.modelspace():
        kind, layer = entity.dxftype(), entity.dxf.layer
        if kind not in ('LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'DIMENSION', 'TEXT'):
            return fail('UNSUPPORTED_MODEL_ENTITY')
        thickness = entity.dxf.get('thickness', 0) if entity.dxf.is_supported('thickness') else 0
        if not near(point(entity.dxf.get('extrusion', (0, 0, 1))), [0, 0, 1]) or not near(float(thickness), 0):
            return fail('NON_PLANAR_ENTITY')
        if entity.dxf.get('linetype', 'BYLAYER').upper() != 'BYLAYER' or entity.dxf.get('lineweight', -1) != -1 or entity.dxf.get('invisible', 0) or not near(float(entity.dxf.get('ltscale', 1)), 1):
            return fail('ENTITY_STYLE_OVERRIDE')
        if kind == 'LINE':
            payload = {'start': point(entity.dxf.start), 'end': point(entity.dxf.end)}
            if not near(payload['start'][2], 0) or not near(payload['end'][2], 0):
                return fail('NONZERO_Z')
        elif kind in ('CIRCLE', 'ARC'):
            payload = {'center': point(entity.dxf.center), 'radius': float(entity.dxf.radius)}
            if not near(payload['center'][2], 0):
                return fail('NONZERO_Z')
            if kind == 'ARC':
                payload.update(startAngle=float(entity.dxf.start_angle), endAngle=float(entity.dxf.end_angle))
        elif kind == 'LWPOLYLINE':
            points = list(entity.get_points('xyseb'))
            if not near(float(entity.dxf.get('elevation', 0)), 0) or not near(float(entity.dxf.get('const_width', 0)), 0) or any(not near(float(v), 0) for p in points for v in p[2:]):
                return fail('POLYLINE_NON_PLANAR_WIDTH_OR_BULGE')
            payload = {'vertices': [[p[0], p[1], 0] for p in points], 'closed': entity.closed}
        elif kind == 'TEXT':
            if layer != 'NOTES' or not near(float(entity.dxf.insert.z), 0):
                return fail('TEXT_LAYER_OR_PLANE')
            notes.append(entity)
            continue
        else:
            if layer != 'DIMENSIONS' or entity.dxf.get('text', '') not in ('', '<>'):
                return fail('DIMENSION_LAYER_OR_TEXT_OVERRIDE')
            if not entity.dxf.get('geometry', '') or entity.dxf.geometry not in doc.blocks:
                return fail('MISSING_DIMENSION_DISPLAY_BLOCK')
            actual_dims.append(entity)
            continue
        shapes.extend(geometry(kind, payload, layer))
    for entity in expected['geometry']:
        payload = dict(entity['payload'])
        if entity['type'] == 'ARC':
            payload['startAngle'] = math.degrees(payload['startAngle'])
            payload['endAngle'] = math.degrees(payload['endAngle'])
        for required in geometry(entity['type'], payload, entity['layer']):
            found = next((i for i, shape in enumerate(shapes) if near(required, shape)), None)
            if found is None:
                return fail('MISSING_OR_INACCURATE_GEOMETRY')
            shapes.pop(found)
    if shapes:
        return fail('EXTRA_GEOMETRY')
    for required in expected['dimensions']:
        subtype = {'ROTATED': 0, 'ALIGNED': 1, 'DIAMETER': 3}[required['kind']]
        def matches(entity):
            if entity.dimtype != subtype:
                return False
            anchors = [point(entity.dxf.defpoint), point(entity.dxf.defpoint4)] if subtype == 3 else [point(entity.dxf.defpoint2), point(entity.dxf.defpoint3)]
            return near(required['anchors'], anchors) or near(required['anchors'], anchors[::-1])
        index = next((i for i, entity in enumerate(actual_dims) if matches(entity)), None)
        if index is None:
            return fail('MISSING_NATIVE_DIMENSION_ANCHORS')
        entity = actual_dims.pop(index)
        measurement = entity.get_measurement()
        if not near(float(measurement), required['value']) or not near(float(entity.dxf.get('actual_measurement', measurement)), required['value']):
            return fail('DIMENSION_MEASUREMENT')
        if subtype == 0 and not near(float(entity.dxf.get('angle', 0)) % 180, required['rotationDegrees'] % 180):
            return fail('DIMENSION_ROTATION')
        placement = point(entity.dxf.text_midpoint) if subtype == 3 else point(entity.dxf.defpoint)
        if not near(placement, required['position']):
            return fail('DIMENSION_PLACEMENT')
        overrides = entity.override()
        if float(overrides.get('dimtxt', 0)) < 3 or not near(float(overrides.get('dimlfac', 1)), 1) or not near(float(overrides.get('dimscale', 1)), 1):
            return {**fail('DIMENSION_TEXT_SIZE_OR_SCALE'), 'dimensionId': required['id'], 'actualTextHeight': overrides.get('dimtxt', 0), 'actualLinearFactor': overrides.get('dimlfac', 1)}
    if actual_dims:
        return fail('EXTRA_DIMENSION')
    normalize = lambda text: ' '.join(text.upper().split())
    for required in expected['notes']:
        index = next((i for i, e in enumerate(notes) if normalize(e.dxf.text) == normalize(required['text'])), None)
        if index is None:
            return fail('MISSING_REQUIRED_NOTE')
        entity = notes.pop(index)
        if not near(point(entity.dxf.insert), required['position']) or float(entity.dxf.height) < required['height'] or not near(float(entity.dxf.get('rotation', 0)), 0):
            return fail('NOTE_PLACEMENT_OR_HEIGHT')
        if not near(float(entity.dxf.get('width', 1)), 1) or not near(float(entity.dxf.get('oblique', 0)), 0) or entity.dxf.get('halign', 0) != 0 or entity.dxf.get('valign', 0) != 0 or entity.dxf.get('text_generation_flag', 0) != 0:
            return fail('NOTE_ALIGNMENT_OR_DISTORTION')
    if notes:
        return fail('EXTRA_NOTE')
    return {**result, 'passed': True, 'extraShapes': 0, 'dimensionsChecked': len(expected['dimensions']), 'notesChecked': len(expected['notes'])}


def main():
    metadata = {'validator': 'ezdxf-engineering', 'version': ezdxf.__version__}
    if '--probe' in sys.argv:
        print(json.dumps(metadata))
        return
    input_path = os.environ.get('KJDRAW_FILE_STDIN_PATH')
    with open(input_path, 'rb') if input_path else sys.stdin.buffer as stream:
        raw = stream.read(4194305)
    if len(raw) > 4194304:
        raise ValueError('size')
    data = json.loads(raw)
    try:
        result = validate(data['dxf'], data['expected'])
    except Exception as error:
        result = {'passed': False, 'reason': 'DXF_VALIDATION_' + type(error).__name__}
    print(json.dumps({**metadata, **result}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'error': 'INDEPENDENT_VALIDATOR_UNAVAILABLE'}))
        sys.exit(1)
