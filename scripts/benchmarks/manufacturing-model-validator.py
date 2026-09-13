"""Independent ezdxf validator for the high-density fixture-plate task.

Expected geometry is recomputed from the public semantic contract. This module does
not import KJDraw code, inspect compiler evidence, or accept rendered pixels as proof.
"""
import io
import json
import math
import os
import sys
import ezdxf


TOLERANCE = 1e-6


def near(a, b, tolerance=TOLERANCE):
    if isinstance(a, (list, tuple)):
        return isinstance(b, (list, tuple)) and len(a) == len(b) and all(near(x, y, tolerance) for x, y in zip(a, b))
    if isinstance(a, str):
        return isinstance(b, str) and a == b
    return isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isfinite(float(a)) and math.isfinite(float(b)) and abs(float(a) - float(b)) <= tolerance


def point(value):
    return [float(value[0]), float(value[1]), float(value[2])]


def p3(x, y):
    return [float(x), float(y), 0.0]


def segment(a, b, layer):
    return ['LINE', layer, *sorted([p3(a[0], a[1]), p3(b[0], b[1])])]


def add_rect(shapes, x, y, width, height, layer):
    corners = [(x, y), (x + width, y), (x + width, y + height), (x, y + height)]
    for index in range(4):
        shapes.append(segment(corners[index], corners[(index + 1) % 4], layer))


def add_line(shapes, x1, y1, x2, y2, layer):
    shapes.append(segment((x1, y1), (x2, y2), layer))


def add_circle(shapes, x, y, radius):
    shapes.append(['CIRCLE', 'OUTLINE', p3(x, y), float(radius)])


def add_arc(shapes, x, y, radius, start, end):
    shapes.append(['ARC', 'OUTLINE', p3(x, y), float(radius), float(start) % 360, float(end) % 360])


def contract_shapes(expected):
    shapes = []
    sheet_x, sheet_y = expected['sheet']['origin']
    sheet_width, sheet_height = expected['sheet']['size']
    top_x, top_y = expected['views']['top']['origin']
    front_x, front_y = expected['views']['front']['origin']
    length, width, thickness = (expected['plate'][key] for key in ('length', 'width', 'thickness'))
    text_height = expected['dimensionTextHeight']

    add_rect(shapes, sheet_x, sheet_y, sheet_width, sheet_height, 'SHEET')
    add_rect(shapes, top_x, top_y, length, width, 'OUTLINE')
    add_rect(shapes, front_x, front_y, length, thickness, 'OUTLINE')
    add_line(shapes, top_x - text_height, top_y + width / 2, top_x + length + text_height, top_y + width / 2, 'CENTER')
    add_line(shapes, top_x + length / 2, top_y - text_height, top_x + length / 2, top_y + width + text_height, 'CENTER')
    add_line(shapes, front_x - text_height, front_y + thickness / 2, front_x + length + text_height, front_y + thickness / 2, 'CENTER')

    for pattern in expected['holePatterns']:
        projected_columns = set()
        feature_radius = pattern['throughDiameter'] * 0.75
        center_size = max(text_height, feature_radius)
        for row in range(pattern['rows']):
            for column in range(pattern['columns']):
                plate_x = pattern['origin'][0] + column * pattern['spacing'][0]
                plate_y = pattern['origin'][1] + row * pattern['spacing'][1]
                x, y = top_x + plate_x, top_y + plate_y
                add_circle(shapes, x, y, pattern['throughDiameter'] / 2)
                if pattern.get('counterboreDiameter') is not None:
                    add_circle(shapes, x, y, pattern['counterboreDiameter'] / 2)
                add_line(shapes, x - center_size, y, x + center_size, y, 'CENTER')
                add_line(shapes, x, y - center_size, x, y + center_size, 'CENTER')
                if plate_x in projected_columns:
                    continue
                projected_columns.add(plate_x)
                projected_x = front_x + plate_x
                through_radius = pattern['throughDiameter'] / 2
                through_top = front_y + thickness - pattern.get('counterboreDepth', 0)
                add_line(shapes, projected_x - through_radius, front_y, projected_x - through_radius, through_top, 'HIDDEN')
                add_line(shapes, projected_x + through_radius, front_y, projected_x + through_radius, through_top, 'HIDDEN')
                add_line(shapes, projected_x, front_y - text_height, projected_x, front_y + thickness + text_height, 'CENTER')
                if pattern.get('counterboreDiameter') is not None:
                    counterbore_radius = pattern['counterboreDiameter'] / 2
                    counterbore_bottom = front_y + thickness - pattern['counterboreDepth']
                    add_line(shapes, projected_x - counterbore_radius, counterbore_bottom, projected_x - counterbore_radius, front_y + thickness, 'HIDDEN')
                    add_line(shapes, projected_x + counterbore_radius, counterbore_bottom, projected_x + counterbore_radius, front_y + thickness, 'HIDDEN')
                    add_line(shapes, projected_x - counterbore_radius, counterbore_bottom, projected_x - through_radius, counterbore_bottom, 'HIDDEN')
                    add_line(shapes, projected_x + through_radius, counterbore_bottom, projected_x + counterbore_radius, counterbore_bottom, 'HIDDEN')

    for slot in expected['slots']:
        cx, cy = top_x + slot['center'][0], top_y + slot['center'][1]
        radius = slot['width'] / 2
        half_straight = (slot['length'] - slot['width']) / 2
        half_length = slot['length'] / 2
        if slot['orientationDegrees'] == 0:
            add_line(shapes, cx - half_straight, cy + radius, cx + half_straight, cy + radius, 'OUTLINE')
            add_line(shapes, cx + half_straight, cy - radius, cx - half_straight, cy - radius, 'OUTLINE')
            add_arc(shapes, cx + half_straight, cy, radius, 270, 90)
            add_arc(shapes, cx - half_straight, cy, radius, 90, 270)
            add_line(shapes, cx - half_length - text_height, cy, cx + half_length + text_height, cy, 'CENTER')
            add_line(shapes, cx, cy - radius - text_height, cx, cy + radius + text_height, 'CENTER')
            projected_half_width = half_length
        else:
            add_line(shapes, cx - radius, cy - half_straight, cx - radius, cy + half_straight, 'OUTLINE')
            add_line(shapes, cx + radius, cy + half_straight, cx + radius, cy - half_straight, 'OUTLINE')
            add_arc(shapes, cx, cy + half_straight, radius, 0, 180)
            add_arc(shapes, cx, cy - half_straight, radius, 180, 0)
            add_line(shapes, cx, cy - half_length - text_height, cx, cy + half_length + text_height, 'CENTER')
            add_line(shapes, cx - radius - text_height, cy, cx + radius + text_height, cy, 'CENTER')
            projected_half_width = radius
        add_line(shapes, front_x + slot['center'][0] - projected_half_width, front_y, front_x + slot['center'][0] - projected_half_width, front_y + thickness, 'HIDDEN')
        add_line(shapes, front_x + slot['center'][0] + projected_half_width, front_y, front_x + slot['center'][0] + projected_half_width, front_y + thickness, 'HIDDEN')

    margin, title_height = 8, 36
    title_x, title_y = sheet_x + margin, sheet_y + margin
    title_width = sheet_width - margin * 2
    title_split = title_x + title_width * 0.62
    add_rect(shapes, title_x, title_y, title_width, title_height, 'SHEET')
    add_line(shapes, title_split, title_y, title_split, title_y + title_height, 'SHEET')
    add_line(shapes, title_split, title_y + title_height / 2, title_x + title_width, title_y + title_height / 2, 'SHEET')
    return shapes


def contract_dimensions(expected):
    top_x, top_y = expected['views']['top']['origin']
    front_x, front_y = expected['views']['front']['origin']
    length, width, thickness = (expected['plate'][key] for key in ('length', 'width', 'thickness'))
    pad = 12
    dimensions = [
        ('ALIGNED', [p3(top_x, top_y), p3(top_x + length, top_y)], p3(top_x + length / 2, top_y - pad / 2), length),
        ('ALIGNED', [p3(top_x, top_y), p3(top_x, top_y + width)], p3(top_x - pad / 2, top_y + width / 2), width),
        ('ALIGNED', [p3(front_x, front_y), p3(front_x, front_y + thickness)], p3(front_x - pad / 2, front_y + thickness / 2), thickness),
    ]
    for pattern in expected['holePatterns']:
        cx, cy = top_x + pattern['origin'][0], top_y + pattern['origin'][1]
        radius = pattern['throughDiameter'] / 2
        dimensions.append(('DIAMETER', [p3(cx - radius, cy), p3(cx + radius, cy)], p3(cx + pad, cy + pad / 2), pattern['throughDiameter']))
        if pattern['columns'] > 1:
            pitch = pattern['spacing'][0]
            dimensions.append(('ALIGNED', [p3(cx, cy), p3(cx + pitch, cy)], p3(cx + pitch / 2, cy - pad / 2), pitch))
        if pattern['rows'] > 1:
            pitch = pattern['spacing'][1]
            dimensions.append(('ALIGNED', [p3(cx, cy), p3(cx, cy + pitch)], p3(cx - pad / 2, cy + pitch / 2), pitch))
    for slot in expected['slots']:
        cx, cy = top_x + slot['center'][0], top_y + slot['center'][1]
        half = slot['length'] / 2
        radius = slot['width'] / 2
        if slot['orientationDegrees'] == 0:
            dimensions.append(('ALIGNED', [p3(cx - half, cy), p3(cx + half, cy)], p3(cx, cy + radius + pad / 2), slot['length']))
        else:
            dimensions.append(('ALIGNED', [p3(cx, cy - half), p3(cx, cy + half)], p3(cx + radius + pad / 2, cy), slot['length']))
    return dimensions


def normalize_text(value):
    return ' '.join(str(value).upper().split())


def validate(dxf, expected):
    doc = ezdxf.read(io.StringIO(dxf, newline=None))
    audit = doc.audit()
    result = {
        'passed': False,
        'unitsCorrect': doc.header.get('$INSUNITS', 0) == 4,
        'auditErrors': len(audit.errors),
        'auditFixes': len(audit.fixes),
        'entities': len(doc.modelspace()),
    }

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

    dims = [entity for entity in doc.modelspace() if entity.dxftype() == 'DIMENSION']
    dim_blocks = {entity.dxf.get('geometry', '') for entity in dims}
    for block in doc.blocks:
        if block.is_any_layout or not len(block):
            continue
        if block.name not in dim_blocks or not block.name.startswith('*D'):
            return fail('EXTRA_NON_DIMENSION_BLOCK')
        if any(entity.dxftype() not in ('LINE', 'SOLID', 'TEXT', 'MTEXT', 'ARC', 'POINT') for entity in block):
            return fail('UNSUPPORTED_DIMENSION_BLOCK_CONTENT')

    for layer in expected['layers']:
        if layer['name'] not in doc.layers:
            return fail('MISSING_REQUIRED_LAYER')
        native = doc.layers.get(layer['name'])
        if native.is_off() or native.is_frozen() or native.is_locked() or native.dxf.lineweight != layer['lineweight']:
            return fail('LAYER_VISIBILITY_OR_LINEWEIGHT')
        linetype = doc.linetypes.get(native.dxf.linetype)
        pattern = [float(tag.value) for tag in linetype.pattern_tags.tags if tag.code == 49]
        if not near(layer['pattern'], pattern):
            return fail('LAYER_DASH_PATTERN')

    shapes, notes, actual_dims = [], [], []
    allowed_layers = {layer['name'] for layer in expected['layers']}
    for entity in doc.modelspace():
        kind, layer = entity.dxftype(), entity.dxf.layer
        if kind not in ('LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'DIMENSION', 'TEXT') or layer not in allowed_layers:
            return fail('UNSUPPORTED_MODEL_ENTITY_OR_LAYER')
        thickness = entity.dxf.get('thickness', 0) if entity.dxf.is_supported('thickness') else 0
        if not near(point(entity.dxf.get('extrusion', (0, 0, 1))), [0, 0, 1]) or not near(float(thickness), 0):
            return fail('NON_PLANAR_ENTITY')
        if entity.dxf.get('linetype', 'BYLAYER').upper() != 'BYLAYER' or entity.dxf.get('lineweight', -1) != -1 or entity.dxf.get('invisible', 0) or not near(float(entity.dxf.get('ltscale', 1)), 1):
            return fail('ENTITY_STYLE_OVERRIDE')
        if kind == 'TEXT':
            if layer != 'NOTES' or not near(float(entity.dxf.insert.z), 0) or float(entity.dxf.height) < expected['dimensionTextHeight']:
                return fail('TEXT_LAYER_PLANE_OR_HEIGHT')
            if not near(float(entity.dxf.get('rotation', 0)), 0) or not near(float(entity.dxf.get('width', 1)), 1) or not near(float(entity.dxf.get('oblique', 0)), 0):
                return fail('TEXT_DISTORTION')
            notes.append(entity)
            continue
        if kind == 'DIMENSION':
            if layer != 'DIMENSIONS' or entity.dxf.get('text', '') not in ('', '<>'):
                return fail('DIMENSION_LAYER_OR_TEXT_OVERRIDE')
            if not entity.dxf.get('geometry', '') or entity.dxf.geometry not in doc.blocks:
                return fail('MISSING_DIMENSION_DISPLAY_BLOCK')
            actual_dims.append(entity)
            continue
        if kind == 'LINE':
            a, b = point(entity.dxf.start), point(entity.dxf.end)
            if not near(a[2], 0) or not near(b[2], 0):
                return fail('NONZERO_Z')
            shapes.append(segment(a, b, layer))
        elif kind == 'CIRCLE':
            center = point(entity.dxf.center)
            if not near(center[2], 0):
                return fail('NONZERO_Z')
            shapes.append(['CIRCLE', layer, center, float(entity.dxf.radius)])
        elif kind == 'ARC':
            center = point(entity.dxf.center)
            if not near(center[2], 0):
                return fail('NONZERO_Z')
            shapes.append(['ARC', layer, center, float(entity.dxf.radius), float(entity.dxf.start_angle) % 360, float(entity.dxf.end_angle) % 360])
        else:
            points = list(entity.get_points('xyseb'))
            if not near(float(entity.dxf.get('elevation', 0)), 0) or not near(float(entity.dxf.get('const_width', 0)), 0) or any(not near(float(value), 0) for item in points for value in item[2:]):
                return fail('POLYLINE_NON_PLANAR_WIDTH_OR_BULGE')
            vertices = [p3(item[0], item[1]) for item in points]
            for index in range(len(vertices) if entity.closed else len(vertices) - 1):
                shapes.append(segment(vertices[index], vertices[(index + 1) % len(vertices)], layer))

    required_shapes = contract_shapes(expected)
    for required in required_shapes:
        index = next((index for index, actual in enumerate(shapes) if near(required, actual)), None)
        if index is None:
            return {**fail('MISSING_OR_INACCURATE_GEOMETRY'), 'missing': required}
        shapes.pop(index)
    if shapes:
        return fail('EXTRA_GEOMETRY')

    required_dimensions = contract_dimensions(expected)
    if len(required_dimensions) != expected['nativeDimensionCount']:
        return fail('INVALID_EXPECTED_DIMENSION_CONTRACT')
    for kind, anchors, placement, value in required_dimensions:
        subtype = 3 if kind == 'DIAMETER' else 1

        def matches(entity):
            if entity.dimtype != subtype:
                return False
            actual = [point(entity.dxf.defpoint), point(entity.dxf.defpoint4)] if subtype == 3 else [point(entity.dxf.defpoint2), point(entity.dxf.defpoint3)]
            return near(anchors, actual) or near(anchors, actual[::-1])

        index = next((index for index, entity in enumerate(actual_dims) if matches(entity)), None)
        if index is None:
            return fail('MISSING_NATIVE_DIMENSION_ANCHORS')
        entity = actual_dims.pop(index)
        measurement = float(entity.get_measurement())
        if not near(measurement, value) or not near(float(entity.dxf.get('actual_measurement', measurement)), value):
            return fail('DIMENSION_MEASUREMENT')
        actual_placement = point(entity.dxf.text_midpoint) if subtype == 3 else point(entity.dxf.defpoint)
        if not near(actual_placement, placement):
            return fail('DIMENSION_PLACEMENT')
        overrides = entity.override()
        if float(overrides.get('dimtxt', 0)) < expected['dimensionTextHeight'] or not near(float(overrides.get('dimlfac', 1)), 1) or not near(float(overrides.get('dimscale', 1)), 1):
            return fail('DIMENSION_TEXT_SIZE_OR_SCALE')
    if actual_dims:
        return fail('EXTRA_DIMENSION')

    required_notes = [normalize_text(value) for value in expected['requiredNotes']]
    actual_notes = [normalize_text(entity.dxf.text) for entity in notes]
    if sorted(actual_notes) != sorted(required_notes):
        return fail('MISSING_OR_EXTRA_REQUIRED_NOTE')
    sheet_x, sheet_y = expected['sheet']['origin']
    sheet_width, sheet_height = expected['sheet']['size']
    if any(not (sheet_x - TOLERANCE <= entity.dxf.insert.x <= sheet_x + sheet_width + TOLERANCE and sheet_y - TOLERANCE <= entity.dxf.insert.y <= sheet_y + sheet_height + TOLERANCE) for entity in notes):
        return fail('NOTE_OUTSIDE_SHEET')

    return {
        **result,
        'passed': True,
        'geometrySegmentsChecked': len(required_shapes),
        'dimensionsChecked': len(required_dimensions),
        'notesChecked': len(required_notes),
        'workingHolesChecked': expected['holePatterns'][0]['rows'] * expected['holePatterns'][0]['columns'],
        'mountingHolesChecked': expected['holePatterns'][1]['rows'] * expected['holePatterns'][1]['columns'],
        'slotsChecked': len(expected['slots']),
    }


def main():
    metadata = {'validator': 'ezdxf-manufacturing', 'version': ezdxf.__version__}
    if '--probe' in sys.argv:
        print(json.dumps(metadata))
        return
    input_path = os.environ.get('KJDRAW_FILE_STDIN_PATH')
    with open(input_path, 'rb') if input_path else sys.stdin.buffer as stream:
        raw = stream.read(8388609)
    if len(raw) > 8388608:
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
