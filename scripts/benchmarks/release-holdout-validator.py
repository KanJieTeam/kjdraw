"""Independent exact-geometry validator for the versioned release holdout suite."""
import io
import json
import math
import os
import sys

import ezdxf


def near(left, right, tolerance):
    return math.isfinite(float(left)) and math.isfinite(float(right)) and abs(float(left) - float(right)) <= tolerance


def point2(value):
    return [float(value[0]), float(value[1])]


def same_point(left, right, tolerance):
    return len(left) >= 2 and len(right) >= 2 and near(left[0], right[0], tolerance) and near(left[1], right[1], tolerance)


def cyclic_vertices_equal(actual, expected, tolerance):
    if len(actual) != len(expected):
        return False
    for candidate in (actual, list(reversed(actual))):
        for offset in range(len(candidate)):
            if all(same_point(candidate[(index + offset) % len(candidate)], expected[index], tolerance) for index in range(len(expected))):
                return True
    return False


def entity_record(entity):
    kind = entity.dxftype()
    layer = entity.dxf.layer
    if kind == 'LINE':
        return {'type': kind, 'layer': layer, 'start': point2(entity.dxf.start), 'end': point2(entity.dxf.end)}
    if kind == 'CIRCLE':
        return {'type': kind, 'layer': layer, 'center': point2(entity.dxf.center), 'radius': float(entity.dxf.radius)}
    if kind == 'ARC':
        return {'type': kind, 'layer': layer, 'center': point2(entity.dxf.center), 'radius': float(entity.dxf.radius), 'startDegrees': float(entity.dxf.start_angle) % 360, 'endDegrees': float(entity.dxf.end_angle) % 360}
    if kind == 'LWPOLYLINE':
        return {'type': kind, 'layer': layer, 'vertices': [[float(item[0]), float(item[1])] for item in entity.get_points('xy')], 'closed': bool(entity.closed)}
    if kind in ('TEXT', 'MTEXT'):
        value = entity.dxf.text if kind == 'TEXT' else entity.plain_text()
        insert = entity.dxf.insert
        height = entity.dxf.height if kind == 'TEXT' else entity.dxf.char_height
        return {'type': 'TEXT', 'layer': layer, 'text': value, 'position': point2(insert), 'height': float(height), 'rotationDegrees': float(entity.dxf.get('rotation', 0)) % 360}
    if kind == 'INSERT':
        return {'type': kind, 'layer': layer, 'blockName': entity.dxf.name, 'position': point2(entity.dxf.insert), 'scale': [float(entity.dxf.get('xscale', 1)), float(entity.dxf.get('yscale', 1))], 'rotationDegrees': float(entity.dxf.get('rotation', 0)) % 360}
    if kind == 'DIMENSION':
        override = entity.dxf.get('text', None)
        if override in ('', '<>'):
            override = None
        return {'type': kind, 'layer': layer, 'definitionPoints': [point2(entity.dxf.defpoint), point2(entity.dxf.defpoint2), point2(entity.dxf.defpoint3)], 'textPosition': point2(entity.dxf.text_midpoint), 'textOverride': override, 'measurement': float(entity.get_measurement())}
    return {'type': kind, 'layer': layer}


def record_matches(actual, expected, tolerance):
    if actual['type'] != expected['type'] or actual['layer'] != expected['layer']:
        return False
    kind = expected['type']
    if kind == 'LINE':
        direct = same_point(actual['start'], expected['start'], tolerance) and same_point(actual['end'], expected['end'], tolerance)
        reverse = same_point(actual['start'], expected['end'], tolerance) and same_point(actual['end'], expected['start'], tolerance)
        return direct or reverse
    if kind == 'CIRCLE':
        return same_point(actual['center'], expected['center'], tolerance) and near(actual['radius'], expected['radius'], tolerance)
    if kind == 'ARC':
        return same_point(actual['center'], expected['center'], tolerance) and near(actual['radius'], expected['radius'], tolerance) and near(actual['startDegrees'] % 360, expected['startDegrees'] % 360, tolerance) and near(actual['endDegrees'] % 360, expected['endDegrees'] % 360, tolerance)
    if kind == 'LWPOLYLINE':
        return actual['closed'] == expected['closed'] and cyclic_vertices_equal(actual['vertices'], expected['vertices'], tolerance)
    if kind == 'TEXT':
        return actual['text'] == expected['text'] and same_point(actual['position'], expected['position'], tolerance) and near(actual['height'], expected['height'], tolerance) and near(actual['rotationDegrees'] % 360, expected.get('rotationDegrees', 0) % 360, tolerance)
    if kind == 'INSERT':
        return actual['blockName'] == expected['blockName'] and same_point(actual['position'], expected['position'], tolerance) and all(near(left, right, tolerance) for left, right in zip(actual['scale'], expected['scale'])) and near(actual['rotationDegrees'] % 360, expected['rotationDegrees'] % 360, tolerance)
    if kind == 'DIMENSION':
        expected_measurement = math.dist(expected['definitionPoints'][1], expected['definitionPoints'][2])
        return len(actual['definitionPoints']) == len(expected['definitionPoints']) and all(same_point(left, right, tolerance) for left, right in zip(actual['definitionPoints'], expected['definitionPoints'])) and same_point(actual['textPosition'], expected['textPosition'], tolerance) and actual['textOverride'] == expected['textOverride'] and near(actual['measurement'], expected_measurement, tolerance)
    return False


def count_records(entities):
    counts = {}
    for entity in entities:
        key = (entity.dxftype(), entity.dxf.layer)
        counts[key] = counts.get(key, 0) + 1
    return counts


def match_polyline(entity, required, tolerance, closed):
    if entity.dxftype() != 'LWPOLYLINE' or entity.dxf.layer != required['layer'] or bool(entity.closed) != closed:
        return False
    actual = [[float(item[0]), float(item[1])] for item in entity.get_points('xy')]
    expected = required['vertices']
    if closed:
        return cyclic_vertices_equal(actual, expected, tolerance)
    return len(actual) == len(expected) and all(same_point(left, right, tolerance) for left, right in zip(actual, expected))


def consume_matches(entities, required, predicate, reasons, code):
    remaining = list(entities)
    for item in required:
        index = next((index for index, entity in enumerate(remaining) if predicate(entity, item)), None)
        if index is None:
            reasons.append(code)
            continue
        remaining.pop(index)
    return remaining


def validate_layouts(doc, contract, units, tolerance, reasons):
    paper_layouts = [layout for layout in doc.layouts if layout.name != 'Model']
    non_empty = [layout for layout in paper_layouts if len(layout) > 0]
    if len(non_empty) != contract['nonEmptyPaperLayouts']:
        reasons.append('LAYOUT_COUNT')
        return
    if any(len(layout) > 0 and layout not in non_empty for layout in paper_layouts):
        reasons.append('EXTRA_PAPERSPACE')
    if len(non_empty) != 1:
        return
    layout = non_empty[0]
    import re
    if re.search(contract['namePattern'], layout.name, re.IGNORECASE) is None:
        reasons.append('LAYOUT_NAME')
    paper = contract['paper']
    dxf = layout.dxf_layout.dxf
    actual_paper = [dxf.get('paper_width', 0), dxf.get('paper_height', 0)]
    if not all(near(a, b, tolerance) for a, b in zip(actual_paper, [paper['width'], paper['height']])):
        reasons.append('PAPER_SIZE')
    entities = list(layout)
    viewports = [entity for entity in entities if entity.dxftype() == 'VIEWPORT']
    if len(entities) != 1 or len(viewports) != 1:
        reasons.append('PAPERSPACE_ENTITIES')
        return
    viewport = viewports[0]
    expected = contract['viewport']
    unit_mm = 1000 if units == 'meter' else 1
    if not near(float(viewport.dxf.height) / float(viewport.dxf.view_height), unit_mm / expected['scaleDenominator'], tolerance / 100):
        reasons.append('VIEWPORT_SCALE')
    center = point2(viewport.dxf.view_center_point)
    half_height = float(viewport.dxf.view_height) / 2
    half_width = half_height * float(viewport.dxf.width) / float(viewport.dxf.height)
    minimum, maximum = expected['requiredModelBounds']
    if center[0] - half_width > minimum[0] + tolerance or center[1] - half_height > minimum[1] + tolerance or center[0] + half_width < maximum[0] - tolerance or center[1] + half_height < maximum[1] - tolerance:
        reasons.append('VIEWPORT_COVERAGE')


def validate_blocks(doc, contract, expected_inserts, tolerance, reasons):
    custom_blocks = [block for block in doc.blocks if not block.name.startswith('*')]
    if len(custom_blocks) != contract['allowedCustomCount']:
        reasons.append('CUSTOM_BLOCK_COUNT')
    custom_names = {block.name for block in custom_blocks}
    inserts = list(doc.modelspace().query('INSERT'))
    if any(insert.dxf.name not in custom_names for insert in inserts):
        reasons.append('MISSING_BLOCK_DEFINITION')
    if contract.get('rejectUnreferencedCustomBlocks') and any(not any(insert.dxf.name == block.name for insert in inserts) for block in custom_blocks):
        reasons.append('ORPHAN_CUSTOM_BLOCK')
    remaining = list(inserts)
    for required in expected_inserts:
        index = next((index for index, insert in enumerate(remaining)
                      if insert.dxf.layer == required['layer']
                      and same_point(point2(insert.dxf.insert), required['position'], tolerance)
                      and near(float(insert.dxf.get('rotation', 0)) % 360, required['rotationDegrees'] % 360, tolerance)), None)
        if index is None:
            reasons.append('INSERT_GEOMETRY')
            continue
        insert = remaining.pop(index)
        block = doc.blocks.get(insert.dxf.name)
        block_counts = {}
        for entity in block:
            block_counts[entity.dxftype()] = block_counts.get(entity.dxftype(), 0) + 1
        if block_counts != required['blockEntityCounts']:
            reasons.append('BLOCK_GEOMETRY')
        if sum(candidate.dxf.name == insert.dxf.name for candidate in inserts) != required['referenceCount']:
            reasons.append('BLOCK_REFERENCE_COUNT')
    if remaining:
        reasons.append('EXTRA_INSERT')


def validate_semantic(doc, expected, tolerance, reasons):
    modelspace = list(doc.modelspace())
    expected_counts = {(item['type'], item['layer']): item['count'] for item in expected['modelspaceCounts']}
    if count_records(modelspace) != expected_counts:
        reasons.append('MODELSPACE_COUNTS')
    layers = {layer.dxf.name for layer in doc.layers}
    if any(name not in layers for name in expected['requiredLayers']):
        reasons.append('LAYERS')
    drawing_text = '\n'.join(entity_record(entity)['text'] for entity in modelspace if entity.dxftype() in ('TEXT', 'MTEXT'))
    if any(fragment not in drawing_text for fragment in expected['requiredTextFragments']):
        reasons.append('TEXT')
    model_contract = expected['contract']['modelspace']
    consume_matches(modelspace, model_contract.get('exactClosedPolylines', []), lambda entity, item: match_polyline(entity, item, tolerance, True), reasons, 'CLOSED_POLYLINE_GEOMETRY')
    consume_matches(modelspace, model_contract.get('exactOpenPolylines', []), lambda entity, item: match_polyline(entity, item, tolerance, False), reasons, 'OPEN_POLYLINE_GEOMETRY')
    circles = [entity for entity in modelspace if entity.dxftype() == 'CIRCLE']
    consume_matches(circles, model_contract.get('exactCircles', []), lambda entity, item: entity.dxf.layer == item['layer'] and same_point(point2(entity.dxf.center), item['center'], tolerance) and float(entity.dxf.radius) >= item.get('minimumRadius', 0) - tolerance and float(entity.dxf.radius) <= item.get('maximumRadius', float('inf')) + tolerance, reasons, 'CIRCLE_GEOMETRY')
    def distance_to_segment(point, start, end):
        dx, dy = end[0] - start[0], end[1] - start[1]
        squared = dx * dx + dy * dy
        if squared == 0:
            return math.dist(point, start)
        ratio = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared))
        return math.dist(point, [start[0] + ratio * dx, start[1] + ratio * dy])
    road_edges = [entity for entity in modelspace if entity.dxftype() == 'LWPOLYLINE' and entity.dxf.layer == 'ROAD_EDGE']
    unused_edges = list(road_edges)
    for road in model_contract.get('roadWidths', []):
        half = road['width'] / 2
        segments = list(zip(road['centerline'], road['centerline'][1:]))
        candidates = []
        for entity in unused_edges:
            vertices = [[float(value[0]), float(value[1])] for value in entity.get_points('xy')]
            distances = [min(distance_to_segment(vertex, start, end) for start, end in segments) for vertex in vertices]
            if distances and abs(min(distances) - half) <= max(tolerance, half * 0.03) and all(half - tolerance <= distance <= half * 1.3 + tolerance for distance in distances):
                candidates.append(entity)
        if len(candidates) < 2:
            reasons.append('ROAD_WIDTH')
        else:
            unused_edges.remove(candidates[0]); unused_edges.remove(candidates[1])
    if unused_edges:
        reasons.append('EXTRA_ROAD_EDGE')
    control = model_contract.get('coordinateControl')
    if control:
        lines = [entity for entity in modelspace if entity.dxftype() == 'LINE' and entity.dxf.layer == 'ANNOTATION']
        crossing = [entity for entity in lines if distance_to_segment(control['position'], point2(entity.dxf.start), point2(entity.dxf.end)) <= tolerance]
        if len(crossing) < 2:
            reasons.append('COORDINATE_MARKER')
        if any(fragment not in drawing_text for fragment in control['textFragments']):
            reasons.append('COORDINATE_TEXT')
    if 'northAngleDegrees' in model_contract:
        target = (90 + model_contract['northAngleDegrees']) % 180
        lines = [entity for entity in modelspace if entity.dxftype() == 'LINE' and entity.dxf.layer == 'ANNOTATION']
        angles = [(math.degrees(math.atan2(float(entity.dxf.end.y - entity.dxf.start.y), float(entity.dxf.end.x - entity.dxf.start.x))) % 180) for entity in lines]
        if not any(abs(((angle - target + 90) % 180) - 90) <= 0.1 for angle in angles):
            reasons.append('NORTH_ANGLE')
    for required in model_contract.get('requiredExtents', []):
        points = []
        for entity in modelspace:
            if entity.dxf.layer == required['layer'] and entity.dxftype() == 'LWPOLYLINE':
                points.extend([[float(value[0]), float(value[1])] for value in entity.get_points('xy')])
        if not points or not same_point([min(value[0] for value in points), min(value[1] for value in points)], required['minimum'], tolerance) or not same_point([max(value[0] for value in points), max(value[1] for value in points)], required['maximum'], tolerance):
            reasons.append('MODEL_EXTENTS')
    actual_measurements = []
    for entity in modelspace:
        if entity.dxftype() == 'DIMENSION':
            try:
                actual_measurements.append(float(entity.get_measurement()))
            except Exception:
                reasons.append('DIMENSION_MEASUREMENT')
    remaining_measurements = list(actual_measurements)
    for required in model_contract.get('dimensionMeasurements', []):
        index = next((index for index, actual in enumerate(remaining_measurements) if near(actual, required, tolerance)), None)
        if index is None:
            reasons.append('DIMENSION_MEASUREMENT')
        else:
            remaining_measurements.pop(index)
    if remaining_measurements:
        reasons.append('EXTRA_DIMENSION')
    validate_layouts(doc, expected['contract']['layouts'], expected['units'], tolerance, reasons)
    validate_blocks(doc, expected['contract']['blocks'], model_contract.get('inserts', []), tolerance, reasons)


def validate(payload):
    expected = payload['expected']
    tolerance = float(expected.get('tolerance', 0.01))
    doc = ezdxf.read(io.StringIO(payload['dxf'], newline=None))
    auditor = doc.audit()
    reasons = []
    if doc.dxfversion not in ('AC1027', 'AC1032'):
        reasons.append('DXF_VERSION')
    expected_units = 6 if expected['units'] == 'meter' else 4
    if int(doc.header.get('$INSUNITS', 0)) != expected_units:
        reasons.append('UNITS')
    if len(auditor.errors) != expected['audit']['errors'] or len(auditor.fixes) != expected['audit']['fixes']:
        reasons.append('AUDIT')
    if expected.get('mode') == 'semantic':
        validate_semantic(doc, expected, tolerance, reasons)
        return {'passed': not reasons, 'reasons': sorted(set(reasons)), 'entities': len(doc.modelspace()), 'auditErrors': len(auditor.errors), 'auditFixes': len(auditor.fixes), 'domains': ['modelspace', 'layouts', 'blocks']}
    actual = [entity_record(entity) for entity in doc.modelspace()]
    allowed = {'LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'TEXT'}
    if any(item['type'] not in allowed for item in actual):
        reasons.append('UNSUPPORTED_ENTITY')
    counts = {kind: sum(item['type'] == kind for item in actual) for kind in allowed}
    if counts != expected['entityCounts']:
        reasons.append('ENTITY_COUNTS')
    layers = {layer.dxf.name for layer in doc.layers}
    if any(name not in layers for name in expected['requiredLayers']):
        reasons.append('LAYERS')
    remaining = [item for item in actual if item['type'] != 'TEXT']
    for required in expected['geometry']:
        match = next((index for index, item in enumerate(remaining) if record_matches(item, required, tolerance)), None)
        if match is None:
            reasons.append('GEOMETRY')
            break
        remaining.pop(match)
    if remaining or (not expected['allowExtraModelspaceEntities'] and len(actual) != sum(expected['entityCounts'].values())):
        reasons.append('EXTRA_GEOMETRY')
    actual_text = [item for item in actual if item['type'] == 'TEXT']
    for required in expected['texts']:
        match = next((index for index, item in enumerate(actual_text) if item['layer'] == required['layer'] and item['text'] == required['value'] and same_point(item['position'], required['position'], tolerance) and near(item['height'], required['height'], tolerance)), None)
        if match is None:
            reasons.append('TEXT')
            break
        actual_text.pop(match)
    if actual_text:
        reasons.append('EXTRA_TEXT')
    return {'passed': not reasons, 'reasons': sorted(set(reasons)), 'entities': len(actual), 'auditErrors': len(auditor.errors), 'auditFixes': len(auditor.fixes)}


def main():
    metadata = {'validator': 'ezdxf-release-holdout', 'version': ezdxf.__version__}
    if '--probe' in sys.argv:
        print(json.dumps(metadata))
        return
    input_path = os.environ.get('KJDRAW_FILE_STDIN_PATH')
    with open(input_path, 'rb') if input_path else sys.stdin.buffer as stream:
        raw = stream.read(67108865)
    if len(raw) > 67108864:
        raise ValueError('INPUT_TOO_LARGE')
    data = json.loads(raw)
    if isinstance(data, dict) and isinstance(data.get('cases'), list):
        results = [{'id': case['id'], **validate(case)} for case in data['cases']]
        print(json.dumps({**metadata, 'passed': all(item['passed'] for item in results), 'results': results}))
        return
    if not isinstance(data, dict) or not isinstance(data.get('dxf'), str) or not isinstance(data.get('expected'), dict):
        raise ValueError('INVALID_INPUT')
    print(json.dumps({**metadata, **validate(data)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': 'INDEPENDENT_VALIDATOR_UNAVAILABLE', 'errorType': type(error).__name__}))
        sys.exit(1)
