"""Original custom pattern fixture and independent numeric acceptance."""
import json
import math
import sys
import ezdxf

action, path = sys.argv[1:]
if action == 'generate':
    doc = ezdxf.new('R2018')
    hatch = doc.modelspace().add_hatch()
    hatch.set_pattern_fill('KJDRAW_ORIGINAL_DASH_DOT', style=0, pattern_type=2,
                           definition=[[0, (1, 0), (2, 4), [2, -2, 0, -2]], [90, (0, 1), (-6, 1), []]])
    hatch.paths.add_polyline_path([(0, 0), (24, 0), (24, 24), (0, 24)], is_closed=True, flags=1)
    hatch.paths.add_polyline_path([(8, 8), (16, 8), (16, 16), (8, 16)], is_closed=True, flags=0)
    doc.saveas(path)
elif action == 'inspect':
    doc = ezdxf.readfile(path)
    audit = doc.audit()
    assert not audit.errors and not audit.fixes, (audit.errors, audit.fixes)
    hatches = list(doc.modelspace().query('HATCH'))
    assert len(hatches) == 1
    h = hatches[0]
    assert len(h.paths) == 2
    print(json.dumps({'version': ezdxf.__version__, 'paths': [list(p.vertices) for p in h.paths],
                      'lines': [{'angle': l.angle, 'base': list(l.base_point), 'offset': list(l.offset), 'dashes': list(l.dash_length_items)} for l in h.pattern.lines]}))
else:
    raise ValueError('unknown action')
