"""Original unbounded-line fixture and independent native DXF inspection."""
import json
import sys
import ezdxf

action, path = sys.argv[1:]
if action == 'generate':
    doc = ezdxf.new('R2018')
    doc.modelspace().add_xline((10, 20, 3), (3, 4, 0), dxfattribs={'color': 2, 'lineweight': 35})
    doc.layouts.get('Layout1').add_ray((-10, 5, 6), (-3, 0, 4), dxfattribs={'true_color': 0x123456})
    block = doc.blocks.new('GUIDES')
    block.add_xline((2, 3, 4), (0, -4, 3))
    block.add_ray((5, 6, 7), (0, 1, 0))
    doc.modelspace().add_blockref('GUIDES', (100, 200, 0))
    doc.saveas(path)
elif action != 'inspect':
    raise ValueError('Unknown action')
doc = ezdxf.readfile(path)
audit = doc.audit()
assert not audit.errors and not audit.fixes
spaces = [('Model', doc.modelspace()), ('Layout1', doc.layouts.get('Layout1')), ('GUIDES', doc.blocks.get('GUIDES'))]
lines = []
for name, space in spaces:
    for entity in space.query('XLINE RAY'):
        vector = entity.dxf.unit_vector
        assert abs(vector.magnitude - 1) < 1e-10
        assert entity.dxf.owner == space.block_record_handle
        lines.append({'space': name, 'type': entity.dxftype(), 'origin': list(entity.dxf.start), 'direction': list(vector), 'color': entity.dxf.color, 'trueColor': entity.dxf.get('true_color'), 'lineweight': entity.dxf.lineweight})
print(json.dumps({'lines': lines, 'inserts': len(doc.modelspace().query('INSERT')), 'reader': ezdxf.__version__}))
