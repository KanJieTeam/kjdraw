"""Bounded JSON bridge to the existing independent ezdxf pilot validator."""
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import sys


def contract_failure(dxf, ezdxf):
    """Check the native representation before the historical XY-only comparator."""
    try:
        doc = ezdxf.read(io.StringIO(dxf, newline=None))
        if doc.dxfversion not in ('AC1027', 'AC1032'):
            return 'CONTRACT_REQUIRES_R2013_OR_NEWER'
        zero = lambda value: math.isfinite(float(value)) and abs(float(value)) <= 1e-9
        for layout in doc.layouts:
            if layout.name != 'Model' and len(layout):
                return 'CONTRACT_EXTRA_PAPER_GEOMETRY'
        for block in doc.blocks:
            if not block.is_any_layout and len(block):
                return 'CONTRACT_EXTRA_BLOCK_GEOMETRY'
        for entity in doc.modelspace():
            kind = entity.dxftype()
            if kind not in ('LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE'):
                return 'CONTRACT_UNSUPPORTED_ENTITY'
            normal = entity.dxf.get('extrusion', (0, 0, 1))
            if not (zero(normal[0]) and zero(normal[1]) and zero(normal[2] - 1)):
                return 'CONTRACT_REQUIRES_POSITIVE_Z_NORMAL'
            if not zero(entity.dxf.get('thickness', 0)):
                return 'CONTRACT_NONZERO_THICKNESS'
            if kind == 'LINE':
                if not zero(entity.dxf.start[2]) or not zero(entity.dxf.end[2]):
                    return 'CONTRACT_NONZERO_Z'
            elif kind in ('CIRCLE', 'ARC'):
                if not zero(entity.dxf.center[2]):
                    return 'CONTRACT_NONZERO_Z'
            else:
                if not zero(entity.dxf.get('elevation', 0)):
                    return 'CONTRACT_NONZERO_ELEVATION'
                if not zero(entity.dxf.get('const_width', 0)) or any(not zero(point[2]) or not zero(point[3]) for point in entity.get_points('xyseb')):
                    return 'CONTRACT_NONZERO_POLYLINE_WIDTH'
    except Exception:
        return 'CONTRACT_DXF_PARSE_FAILED'
    return None


def main():
    path = Path(__file__).with_name('deepseek-drawing-pilot.py')
    spec = importlib.util.spec_from_file_location('kjdraw_existing_pilot_validator', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    metadata = {'validator': 'ezdxf', 'version': module.ezdxf.__version__}
    if '--probe' in sys.argv:
        print(json.dumps(metadata))
        return
    input_path = os.environ.get('KJDRAW_FILE_STDIN_PATH')
    with open(input_path, 'rb') if input_path else sys.stdin.buffer as stream:
        raw = stream.read(4194305)
    if len(raw) > 4194304:
        raise ValueError('size')
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get('dxf'), str) or not isinstance(data.get('expected'), dict):
        raise ValueError('input')
    failure = contract_failure(data['dxf'], module.ezdxf)
    result = {'passed': False, 'reason': failure} if failure else module.validate(data['dxf'], data['expected'])
    print(json.dumps({**metadata, **result}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'error': 'INDEPENDENT_VALIDATOR_UNAVAILABLE'}))
        sys.exit(1)
